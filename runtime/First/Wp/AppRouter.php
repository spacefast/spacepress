<?php

declare(strict_types=1);

namespace First\Wp;

use First\Html;
use First\Js;
use First\JsObject;
use First\Render\Halt;
use First\Render\Navigation;
use First\Render\Reads;
use First\Seam;
use First\Viewer;

/**
 * `first/app/` on WordPress (docs/spec/rendering.md, spec.md §5): the one `template_redirect` gate
 * for the front end.
 *
 * Request flow, for GET and HEAD on the public site (wp-admin, REST, feeds, robots, login and cron
 * never reach it, so they work in every mode):
 *
 * 1. Match the path against the compiled route table (most specific first).
 * 2. Guards: each layout's `guard`, outermost first, as the visitor. A refusal sends a signed-out
 *    visitor to the login page and answers 403 to a signed-in one.
 * 3. Render the page inside its layouts with compiled reads bound to the visitor
 *    (`Seam::asViewer`), so drafts and hidden fields never reach the HTML. `notFound()` renders
 *    `not-found.tsx` with a 404, `redirect()` redirects, and anything else thrown renders
 *    `error.tsx` with a 500 and logs the error (its details never reach the page).
 * 4. Emit the document: the layouts' head (title, description, canonical, robots), `wp_head`,
 *    the rendered body inside the router region, `wp_footer`.
 *
 * Unsafe methods on a page with handlers (`export async function POST`) and every method on a
 * `route.ts` are answered on `do_parse_request` instead, like the config's `routes`: before
 * WordPress resolves a query.
 *
 * When `first/app/` exists, First owns the front end: a URL no route matches renders
 * `not-found.tsx` (or WordPress's own 404 page when there is none). Kind URLs WordPress itself
 * resolves (a post, a term archive) keep rendering with the theme until an app route matches them.
 *
 * An anonymous visitor's render of a page outside any guarded layout is cacheable (Batcache and
 * the edge, `First\Render\Cache::policy`); everything else is `private, no-store`. Each cacheable
 * render records the rows it read, so a write purges exactly the URLs that showed it.
 */
final class AppRouter
{
    private static ?self $instance = null;
    /** @var array<string, mixed> */
    private array $app;

    public static function register(Plugin $plugin): void
    {
        $app = $plugin->schema->app();
        if (!is_array($app) || self::$instance !== null) {
            return;
        }
        self::$instance = new self($plugin, $app);
        add_filter('do_parse_request', [self::$instance, 'handlers'], 0);
        // A 0.3.0 capture's `routes` config, read onto this table (`legacyRoutes`), never owned the
        // front end: the theme keeps rendering everything its routes don't serve.
        if ($app['legacyRoutes'] ?? false) {
            return;
        }
        // After the frontend-mode gate (-1) and a kind URL's old-slug redirect (0).
        add_action('template_redirect', [self::$instance, 'claim'], 1);
        add_filter('redirect_canonical', static fn (string|false $redirect): string|false => self::$instance?->serving ? false : $redirect, 10, 1);
    }

    private bool $serving = false;
    /** @var list<string> the stylesheets of the route being rendered, linked by document() */
    private array $styles = [];
    /** This response's `Cache-Control`: private unless serve() found it shareable. */
    private string $cacheControl = 'private, no-store, max-age=0';

    public static function instance(): ?self
    {
        return self::$instance;
    }

    /** @param array<string, mixed> $app */
    private function __construct(private readonly Plugin $plugin, array $app)
    {
        $this->app = $app;
    }

    // ------------------------------------------------------------------ matching

    /**
     * The route for a path below the home URL, with its decoded params: `:name` takes one segment,
     * `*name` one or more, `**name` zero or more (catch-alls as lists).
     *
     * @return ?array{route: array<string, mixed>, params: array<string, string|list<string>>}
     */
    public static function match(array $routes, string $path): ?array
    {
        $segments = [];
        foreach (explode('/', trim($path, '/')) as $raw) {
            if ($raw === '') {
                continue;
            }
            if (preg_match('/%(?![0-9A-Fa-f]{2})/', $raw) === 1) {
                return null;
            }
            $decoded = rawurldecode($raw);
            if ($decoded === '.' || $decoded === '..' || str_contains($decoded, '/') || !mb_check_encoding($decoded, 'UTF-8')) {
                return null;
            }
            $segments[] = $decoded;
        }
        foreach ($routes as $route) {
            $pattern = $route['pattern'] === '/' ? [] : explode('/', trim((string) $route['pattern'], '/'));
            $params = [];
            $ok = true;
            foreach ($pattern as $i => $part) {
                if (str_starts_with($part, '**') || str_starts_with($part, '*')) {
                    $rest = array_slice($segments, $i);
                    if ($rest === [] && !str_starts_with($part, '**')) {
                        $ok = false;
                    }
                    $params[ltrim($part, '*')] = $rest;
                    break;
                }
                if (!array_key_exists($i, $segments)) {
                    $ok = false;
                    break;
                }
                if (str_starts_with($part, ':')) {
                    $params[substr($part, 1)] = $segments[$i];
                } elseif ($part !== $segments[$i]) {
                    $ok = false;
                    break;
                }
            }
            $last = end($pattern);
            $catchAll = is_string($last) && str_starts_with($last, '*');
            if ($ok && ($catchAll || count($pattern) === count($segments))) {
                return ['route' => $route, 'params' => $params];
            }
        }
        return null;
    }

    /**
     * A 0.3.0 `routes` table's routes for one request method (HEAD as GET), in table order: 0.3.0
     * matched a path only among the routes of its method, so `GET /a/b` and `POST /a/:id` both serve.
     *
     * @return list<array<string, mixed>>
     */
    private function legacyRoutes(string $method): array
    {
        $method = $method === 'HEAD' ? 'GET' : $method;
        return array_values(array_filter($this->app['routes'], fn (array $route): bool => isset($this->file($route['handler'] ?? null)['methods'][$method])));
    }

    /** WordPress's and First's own entry points (the compiler's list): never a page, never the app's 404 (spec §5). */
    private function reserved(string $path): bool
    {
        $first = strtolower(rawurldecode(explode('/', ltrim($path, '/'), 2)[0]));
        return in_array($first, $this->app['reserved'] ?? [], true) || str_starts_with($first, 'wp-sitemap');
    }

    private function path(): ?string
    {
        $path = (string) (wp_parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?? '/');
        $base = rtrim((string) (wp_parse_url(home_url('/'), PHP_URL_PATH) ?? '/'), '/');
        if ($base !== '') {
            if ($path !== $base && !str_starts_with($path, $base . '/')) {
                return null;
            }
            $path = substr($path, strlen($base)) ?: '/';
        }
        return $path;
    }

    private function file(?string $path): ?array
    {
        return $path === null ? null : ($this->app['files'][$path] ?? null);
    }

    // ------------------------------------------------------------------ HTTP handlers

    /** `route.ts` (every method) and a page's own handlers (methods other than GET/HEAD). */
    public function handlers(bool $parse): bool
    {
        if (!$parse) {
            return $parse;
        }
        $path = $this->path();
        // A root catch-all never answers WordPress's, First's or the host's own paths (the host's
        // `/__spacefast/connectors/*` and `/__spacefast/client.js` among them), as `claim()` doesn't.
        if ($path === null || $this->reserved($path)) {
            return $parse;
        }
        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        $legacy = $this->app['legacyRoutes'] ?? false;
        $match = self::match($legacy ? $this->legacyRoutes($method) : $this->app['routes'], $path);
        if ($match === null) {
            // 0.3.0 answered a path its routes serve with another method with a 405.
            if ($legacy && self::match($this->app['routes'], $path) !== null) {
                $this->emit(405, ['Content-Type' => 'application/problem+json'], (string) Js::jsonStringify([
                    'type' => 'about:blank', 'title' => 'Method not allowed', 'status' => 405, 'code' => 'method_not_allowed', 'detail' => "$method is not allowed on $path",
                ]));
            }
            return $parse;
        }
        $route = $match['route'];
        $file = $this->file($route['handler'] ?? $route['page'] ?? null);
        $methods = $file['methods'] ?? [];
        $page = ($route['page'] ?? null) !== null;
        $lookup = $method === 'HEAD' ? 'GET' : $method;
        if ($page && ($lookup === 'GET')) {
            return $parse;
        }
        if (!isset($methods[$lookup])) {
            if ($page && $method !== 'POST') {
                return $parse;
            }
            $this->emit(405, ['Content-Type' => 'application/problem+json', 'Allow' => implode(', ', array_keys($methods + ($page ? ['GET' => true] : [])))], (string) Js::jsonStringify([
                'type' => 'about:blank', 'title' => 'Method not allowed', 'status' => 405, 'code' => 'method_not_allowed', 'detail' => "$method is not allowed on $path",
            ]));
        }
        if ($this->plugin->unavailable() !== null) {
            $this->emit(503, ['Content-Type' => 'application/problem+json', 'Retry-After' => '5'], (string) Js::jsonStringify([
                'type' => 'about:blank', 'title' => 'Service unavailable', 'status' => 503, 'code' => 'unavailable', 'detail' => Plugin::UNAVAILABLE,
            ]));
        }
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (is_string($value) && str_starts_with((string) $key, 'HTTP_')) {
                $headers[strtolower(str_replace('_', '-', substr((string) $key, 5)))] = $value;
            }
        }
        foreach (['CONTENT_TYPE' => 'content-type', 'CONTENT_LENGTH' => 'content-length'] as $key => $name) {
            if (isset($_SERVER[$key]) && is_string($_SERVER[$key])) {
                $headers[$name] = $_SERVER[$key];
            }
        }
        try {
            $user = RouteRequest::caller($method, $headers);
        } catch (\First\HttpError $error) {
            $problem = \First\App::problem($error);
            $this->emit($problem['status'], ['Content-Type' => 'application/problem+json'], (string) Js::jsonStringify($problem));
        }
        $params = array_map(static fn ($v) => is_array($v) ? implode('/', $v) : $v, $match['params']);
        // The file's own `access` rule, or its `signature` (verified over the raw body; the
        // handler then runs as the system, spec §3).
        $spec = ['handler' => $methods[$lookup], 'access' => $file['access'] ?? ['allow' => false], 'signature' => $file['signature'] ?? null];
        $query = RouteRequest::query((string) ($_SERVER['QUERY_STRING'] ?? (wp_parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_QUERY) ?? '')));
        $url = RouteRequest::url((string) ($_SERVER['HTTP_HOST'] ?? (wp_parse_url(home_url('/'), PHP_URL_HOST) ?? '')), (string) ($_SERVER['REQUEST_URI'] ?? '/'));
        // An unsigned handler reads as its caller, like a page; a signed webhook runs as the
        // system (spec §3), so its reads are trusted. A 0.3.0 `routes` handler's reads were
        // trusted (`db` in hooks, actions and routes), and still are.
        $viewer = $spec['signature'] !== null || $legacy ? null : new Viewer($user);
        [$status, $out, $body] = Seam::asViewer($viewer, fn (): array => $this->plugin->app()->serveRoute(
            ['name' => (string) $route['id'], 'route' => $spec, 'params' => $params],
            $method, $path, $query, (string) file_get_contents('php://input'), $headers, $user, $url,
        ));
        $this->emit($status, $out, $body);
    }

    // ------------------------------------------------------------------ pages

    public function claim(): void
    {
        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST) || !in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
            return;
        }
        if (is_feed() || is_robots() || is_trackback() || is_favicon() || is_embed()) {
            return;
        }
        $path = $this->path();
        if ($path === null || $this->reserved($path)) {
            return;
        }
        $match = self::match($this->app['routes'], $path);
        $page = $match === null ? null : ($match['route']['page'] ?? null);
        if ($page === null) {
            // A URL WordPress resolved itself (a post, an archive, search) keeps its theme
            // template; anything else is the app's 404.
            if (is_404()) {
                $this->notFound();
            }
            return;
        }
        // The root route is the front page only: `/` also carries `?p=`, `?s=` and other queries
        // WordPress resolves itself.
        if ($match['route']['pattern'] === '/' && !(is_front_page() || is_home())) {
            return;
        }
        $this->serving = true;
        // A static route's code Page ({@see RoutePages}) is the queried object while it renders,
        // as WordPress's own page template would have it: menus, SEO plugins and `the_ID()` see it.
        $id = RoutePages::instance()?->pages()[(string) $match['route']['id']] ?? null;
        if ($id !== null) {
            self::query(get_post($id));
        }
        if ($this->plugin->unavailable() !== null) {
            $this->document(503, ['title' => get_bloginfo('name')], '<p>' . esc_html__('This page is temporarily unavailable.') . '</p>');
        }
        $viewer = CoreAccess::viewer();
        if ($viewer === null) {
            $this->notFound();
        }
        $this->serve($match['route'], $match['params'], $viewer, 200);
    }

    /** The main query as WordPress sets it for a singular Page: `is_page()`, `get_queried_object()`, `$post`. */
    private static function query(?\WP_Post $post): void
    {
        if (!$post instanceof \WP_Post || $post->post_type !== 'page') {
            return;
        }
        $query = new \WP_Query();
        $query->query = ['page_id' => $post->ID];
        $query->query_vars = $query->fill_query_vars($query->query);
        $query->queried_object = $post;
        $query->queried_object_id = $post->ID;
        $query->posts = [$post];
        $query->post = $post;
        $query->post_count = 1;
        $query->found_posts = 1;
        $query->max_num_pages = 1;
        $query->is_page = true;
        $query->is_singular = true;
        $query->is_home = false;
        $GLOBALS['wp_query'] = $query;
        $GLOBALS['wp_the_query'] = $query;
        $GLOBALS['post'] = $post;
        $query->setup_postdata($post);
    }

    private function notFound(): never
    {
        global $wp_query;
        $wp_query->set_404();
        $route = $this->app['notFound'] ?? null;
        $viewer = CoreAccess::viewer() ?? new Viewer(null);
        if (!is_array($route)) {
            $this->document(404, ['title' => __('Page not found')], '<h1>' . esc_html__('Page not found') . '</h1>');
        }
        $this->serve($route, [], $viewer, 404);
    }

    /** @param array<string, string|list<string>> $params */
    private function serve(array $route, array $params, Viewer $viewer, int $status): never
    {
        $this->plugin->app(); // the compiled page functions live in the app's functions.php
        $this->styles = $route['styles'] ?? [];
        $page = $this->file($route['page']);
        $layouts = array_map(fn (string $l): array => $this->file($l) + ['path' => $l], $route['layouts']);
        try {
            foreach ($layouts as $layout) {
                if (($layout['guard'] ?? null) !== null && !$this->allowed($layout['guard'], $viewer)) {
                    if ($viewer->user === null) {
                        nocache_headers();
                        wp_safe_redirect(wp_login_url(home_url((string) ($_SERVER['REQUEST_URI'] ?? '/'))));
                        exit;
                    }
                    $this->document(403, ['title' => __('Forbidden')], '<h1>' . esc_html__('You do not have access to this page.') . '</h1>');
                }
            }
            $props = new JsObject([
                'params' => new JsObject(array_map(static fn ($v) => is_array($v) ? new \First\JsArray($v) : $v, $params)),
            ]);
            if (($page['search'] ?? null) !== null) {
                $props->p['search'] = $this->search($page['search']);
            }
            if (($route['kind'] ?? null) !== null) {
                $item = Seam::asViewer($viewer, fn () => $this->item($route['kind'], $params));
                if ($item === null) {
                    throw Halt::notFoundSignal();
                }
                $props->p['item'] = $item;
            }
            [$head, $body] = Reads::during(fn (): array => Seam::asViewer($viewer, fn (): array => $this->render($page, $layouts, $props)), $reads);
        } catch (Halt $halt) {
            if ($halt->location !== null) {
                nocache_headers();
                wp_redirect(str_starts_with($halt->location, '/') ? home_url($halt->location) : $halt->location, $halt->status);
                exit;
            }
            if ($status === 404) {
                $this->document(404, ['title' => __('Page not found')], '<h1>' . esc_html__('Page not found') . '</h1>');
            }
            $this->notFound();
        } catch (\First\HttpError $error) {
            // A read the visitor may not make (a guarded query) is not found for them.
            if ($error->status === 401 || $error->status === 403 || $error->status === 404) {
                $this->notFound();
            }
            $this->failed($route, $error, $viewer);
        } catch (\Throwable $error) {
            $this->failed($route, $error, $viewer);
        }
        // Cache policy and purges (rendering.md §6.1, §6.2): an anonymous visitor's render of a
        // page no layout guards is shared; what it read decides which writes purge its URL.
        $guarded = array_filter($layouts, static fn (array $l): bool => ($l['guard'] ?? null) !== null) !== [];
        [$this->cacheControl, $shared] = \First\Render\Cache::policy($status, $viewer->user === null, $guarded);
        if ($shared) {
            \First\Render\Cache::record((string) ($_SERVER['REQUEST_URI'] ?? '/'), $reads);
        }
        do_action('first_app_rendered', (string) $route['id'], (string) ($_SERVER['REQUEST_URI'] ?? '/'), $reads);
        $this->document($status, $head, $body);
    }

    /**
     * The item a kind URL names, read as the visitor (the caller binds the viewer), or null when it
     * is missing, not published to them, or the URL isn't its canonical one (`/2025/hello` for a
     * post from 2026). `:slug`/`:path` find the item by slug, `:id` by id.
     *
     * @param array{name: string, params: array<string, string>} $kind
     * @param array<string, string|list<string>> $params
     */
    private function item(array $kind, array $params): ?\First\JsObject
    {
        $name = $kind['name'];
        $spec = $this->plugin->schema->collection($name);
        $value = static fn (string $param) => is_array($params[$param] ?? null) ? implode('/', $params[$param]) : (string) ($params[$param] ?? '');
        $where = null;
        foreach ($kind['params'] as $field => $param) {
            if ($field === 'id' && ctype_digit($value($param))) {
                $where = [$spec['primaryKey'] => (int) $value($param)];
            } elseif ($field === 'path' && ($spec['hierarchical'] ?? false)) {
                // The whole path, parent by parent: a slug is unique among its siblings only.
                $post = get_page_by_path($value($param), OBJECT, (string) $spec['wp']['postType']);
                if (!$post instanceof \WP_Post) {
                    return null;
                }
                // Under an unpublished page, a page is as unreachable as in the tree: its path
                // would name the draft. Editors preview a draft's children in wp-admin.
                foreach (get_post_ancestors($post) as $ancestor) {
                    if (get_post_status($ancestor) !== 'publish') {
                        return null;
                    }
                }
                $where = [$spec['primaryKey'] => $post->ID];
            } elseif (($field === 'slug' || $field === 'path') && ($spec['slug'] ?? null) !== null) {
                $parts = explode('/', $value($param));
                $where = [$spec['slug'] => (string) end($parts)];
            }
        }
        if ($where === null) {
            return null;
        }
        try {
            $row = Seam::findFirst($name, ['where' => $where]);
        } catch (\First\HttpError) {
            return null;
        }
        if ($row === null) {
            return null;
        }
        // The URL must be the item's own: other placeholders (`:year`, a field) have to agree.
        $post = get_post((int) ($row->p[$spec['primaryKey']] ?? 0));
        $urls = KindUrls::instance();
        if ($post instanceof \WP_Post && $urls !== null) {
            $want = $urls->path($name, $post);
            $have = '/' . trim((string) wp_parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH), '/');
            if ($want !== null && rawurldecode($have) !== rawurldecode($want)) {
                return null;
            }
        }
        return $row;
    }

    /**
     * The app's public static pages for `/llms.txt`: (path, title), for each page route with no
     * parameters and no layout guard, titled by its metadata (a literal title, else its path).
     *
     * @return list<array{string, string}>
     */
    public function pages(): array
    {
        $out = [];
        foreach ($this->app['routes'] as $route) {
            if (($route['page'] ?? null) === null || str_contains((string) $route['pattern'], ':') || str_contains((string) $route['pattern'], '*')) {
                continue;
            }
            if ($this->twinRoute(home_url($route['pattern'])) === null) {
                continue;
            }
            // Only pages that render: the twin's heading is the page's title.
            $twin = $this->twin(home_url($route['pattern']));
            if ($twin === null || $twin[0] !== 200) {
                continue;
            }
            $title = preg_match('/^# (.+)$/m', $twin[1], $m) === 1 ? $m[1] : (string) $route['pattern'];
            $out[] = [(string) $route['pattern'], $title];
        }
        return $out;
    }

    /**
     * Whether a URL is a `first/app/` page anyone may see, so whether it has a Markdown twin: a
     * page route (not a handler), outside any layout `guard`.
     */
    public function serves(string $url): bool
    {
        $route = $this->twinRoute($url);
        return $route !== null;
    }

    /**
     * Whether a `first/app/` page under a layout `guard` serves this path (below the home URL): a
     * signed-out visitor is sent to sign in there, so the address is not public.
     */
    public function guarded(string $path): bool
    {
        $match = $this->reserved($path) ? null : self::match($this->app['routes'], $path);
        if ($match === null || ($match['route']['page'] ?? null) === null) {
            return false;
        }
        foreach ($match['route']['layouts'] as $layout) {
            if (($this->file($layout)['guard'] ?? null) !== null) {
                return true;
            }
        }

        return false;
    }

    /** @return ?array{route: array, params: array} */
    private function twinRoute(string $url): ?array
    {
        $path = (string) (wp_parse_url($url, PHP_URL_PATH) ?? '/');
        $base = rtrim((string) (wp_parse_url(home_url('/'), PHP_URL_PATH) ?? '/'), '/');
        if ($base !== '' && str_starts_with($path, $base)) {
            $path = substr($path, strlen($base)) ?: '/';
        }
        if ($this->reserved($path)) {
            return null;
        }
        $match = self::match($this->app['routes'], $path);
        if ($match === null || ($match['route']['page'] ?? null) === null) {
            return null;
        }
        foreach ($match['route']['layouts'] as $layout) {
            if (($this->file($layout)['guard'] ?? null) !== null) {
                return null; // a guarded page is not public: no twin
            }
        }
        return $match;
    }

    /**
     * A `first/app/` page's Markdown twin (rendering.md §5: "code pages render from their compiled
     * output"): the page rendered as an anonymous visitor, its title as the heading, the page's own
     * HTML (not its layouts' navigation) converted to Markdown. Null when the URL is not an app
     * page, so the WordPress twin answers. A missing item or `notFound()` is a 404 twin.
     *
     * @return ?array{int, string}
     */
    public function twin(string $url): ?array
    {
        $match = $this->twinRoute($url);
        if ($match === null) {
            return null;
        }
        $this->plugin->app();
        $viewer = new Viewer(null);
        $route = $match['route'];
        $page = $this->file($route['page']);
        $layouts = array_map(fn (string $l): array => $this->file($l) + ['path' => $l], $route['layouts']);
        try {
            $props = new JsObject([
                'params' => new JsObject(array_map(static fn ($v) => is_array($v) ? new \First\JsArray($v) : $v, $match['params'])),
            ]);
            if (($page['search'] ?? null) !== null) {
                $props->p['search'] = $this->search($page['search']);
            }
            if (($route['kind'] ?? null) !== null) {
                $item = Seam::asViewer($viewer, fn () => $this->item($route['kind'], $match['params']));
                if ($item === null) {
                    return [404, "# Not found\n\nNothing is published at this address.\n"];
                }
                $props->p['item'] = $item;
            }
            // The page alone: its layouts add navigation and chrome, which a twin leaves out.
            [$head, $body] = Seam::asViewer($viewer, fn (): array => $this->render($page, $layouts, $props, false));
        } catch (Halt $halt) {
            return $halt->location === null ? [404, "# Not found\n\nNothing is published at this address.\n"] : null;
        } catch (\Throwable $error) {
            error_log('First page twin ' . ($route['id'] ?? '?') . ' failed: ' . $error::class . ': ' . $error->getMessage());
            return [500, "# Something went wrong\n"];
        }
        $markdown = trim(\First\Sync\Markdown::fromRenderedHtml($body));
        $title = trim((string) $head['title']);
        $doc = ($title !== '' && !str_starts_with($markdown, '# ') ? '# ' . $title . "\n\n" : '') . $markdown;
        return [200, rtrim($doc) . "\n"];
    }

    /** A render error: logged, and the nearest `error.tsx` (or a plain message) with a 500. */
    private function failed(array $route, \Throwable $error, Viewer $viewer): never
    {
        error_log('First page ' . ($route['id'] ?? '?') . ' failed: ' . $error::class . ': ' . $error->getMessage());
        $file = $this->file($route['error'] ?? null);
        if ($file !== null) {
            try {
                $layouts = array_map(fn (string $l): array => $this->file($l) + ['path' => $l], $route['layouts']);
                [$head, $body] = Seam::asViewer($viewer, fn (): array => $this->render($file, $layouts, new JsObject(['params' => new JsObject([])])));
                $this->document(500, $head, $body);
            } catch (\Throwable $again) {
                error_log('First error page failed too: ' . $again->getMessage());
            }
        }
        $this->document(500, ['title' => __('Something went wrong')], '<h1>' . esc_html__('Something went wrong.') . '</h1>');
    }

    private function allowed(array $rule, Viewer $viewer): bool
    {
        $result = \First\Access::evaluate($rule, $viewer, 'read');
        return $result === true;
    }

    /** The page's typed `search`: each field parsed from the query string like action input. */
    private function search(array $fields): JsObject
    {
        $raw = [];
        foreach (\First\QueryString::parse((string) ($_SERVER['QUERY_STRING'] ?? '')) as [$name, $value]) {
            if (!isset($fields[$name]) || array_key_exists($name, $raw)) {
                continue;
            }
            $type = $fields[$name]['type'];
            $raw[$name] = match ($type) {
                'integer' => preg_match('/\A-?\d{1,15}\z/', $value) === 1 ? (int) $value : $value,
                'real' => is_numeric($value) ? (float) $value : $value,
                'boolean' => match ($value) { 'true', '1', '' => true, 'false', '0' => false, default => $value },
                default => $value,
            };
        }
        $out = [];
        foreach ($fields as $name => $field) {
            try {
                $out += \First\Schema::normalizeFields([$name => $field], array_key_exists($name, $raw) ? [$name => $raw[$name]] : [], '');
            } catch (\First\HttpError) {
                // A value the field refuses (`?page=abc`) is as if it were absent.
                $out += \First\Schema::normalizeFields([$name => $field], [], '');
            }
        }
        return Seam::toJs($out, $fields);
    }

    /**
     * The page inside its layouts, innermost first, and the merged head.
     *
     * @param list<array<string, mixed>> $layouts
     * @return array{0: array<string, mixed>, 1: string}
     */
    private function render(?array $page, array $layouts, JsObject $props, bool $wrap = true): array
    {
        Navigation::reset();
        $metadata = [];
        // A twin is the page alone: its heading is the page's own title, not a layout's template.
        foreach ($wrap ? [...$layouts, $page] : [$page] as $file) {
            $meta = $file['metadata'] ?? null;
            if (is_array($meta) && isset($meta['fn'])) {
                $fn = '\\FirstApp\\' . $meta['fn'];
                $meta = Seam::toPhp($fn($props));
            }
            $metadata[] = is_array($meta) ? $meta : [];
        }
        $fn = '\\FirstApp\\' . $page['component'];
        $html = Html::component($fn(...), $props);
        foreach ($wrap ? array_reverse($layouts) : [] as $layout) {
            $layoutProps = new JsObject(['params' => $props->p['params'], 'children' => $html]);
            $layoutFn = '\\FirstApp\\' . $layout['component'];
            $html = Html::component($layoutFn(...), $layoutProps);
        }
        // Rendering runs every component now, so their reads happen inside the visitor binding.
        $body = Html::child($html);
        return [self::head($metadata), $body];
    }

    /**
     * Metadata from the root layout down: later files override earlier ones, and the nearest
     * layout's `title.template` wraps the page's own title.
     *
     * @param list<array<string, mixed>> $metadata
     * @return array<string, mixed>
     */
    public static function head(array $metadata): array
    {
        $template = null;
        $title = null;
        $out = [];
        foreach ($metadata as $meta) {
            foreach ($meta as $key => $value) {
                if ($key === 'title') {
                    if (is_array($value)) {
                        $template = $value['template'] ?? null;
                        $title = $value['default'] ?? $title;
                        $out['titleIsDefault'] = true;
                    } elseif (is_string($value)) {
                        $title = $value;
                        $out['titleIsDefault'] = false;
                    }
                    continue;
                }
                if ($value !== null) {
                    $out[$key] = $value;
                }
            }
        }
        if ($title !== null && $template !== null && !($out['titleIsDefault'] ?? false)) {
            $title = str_replace('%s', $title, (string) $template);
        }
        unset($out['titleIsDefault']);
        $out['title'] = $title ?? get_bloginfo('name');
        return $out;
    }

    // ------------------------------------------------------------------ output

    /** @param array<string, string> $headers */
    private function emit(int $status, array $headers, string $body): never
    {
        status_header($status);
        foreach ($headers as $name => $value) {
            header($name . ': ' . $value, true);
        }
        echo $body;
        exit;
    }

    /** @param array<string, mixed> $head */
    private function document(int $status, array $head, string $body): never
    {
        status_header($status);
        if (str_starts_with($this->cacheControl, 'private')) {
            nocache_headers();
            if (function_exists('batcache_cancel')) {
                batcache_cancel();
            }
        }
        header('Cache-Control: ' . $this->cacheControl);
        header('Content-Type: text/html; charset=' . get_option('blog_charset'));
        // First writes the only <title> and canonical for its pages.
        remove_action('wp_head', '_wp_render_title_tag', 1);
        remove_action('wp_head', '_block_template_render_title_tag', 1);
        remove_action('wp_head', 'rel_canonical');
        $robots = $head['robots'] ?? null;
        if (is_array($robots) || $status !== 200) {
            add_filter('wp_robots', static function (array $r) use ($robots, $status): array {
                if ($status !== 200 || ($robots['index'] ?? true) === false) {
                    $r['noindex'] = true;
                }
                if (($robots['follow'] ?? true) === false) {
                    $r['nofollow'] = true;
                }
                return $r;
            });
        }
        \First\Assets::enqueue($this->styles);
        Navigation::enqueue(plugins_url('first/Render/client/router.js', Runtime::file()));
        \First\Islands::enqueue();
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') {
            exit;
        }
        echo "<!DOCTYPE html>\n<html " . get_language_attributes() . ">\n<head>\n<meta charset=\"" . esc_attr((string) get_option('blog_charset')) . "\">\n";
        echo "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n";
        echo '<title>' . esc_html((string) $head['title']) . "</title>\n";
        if (is_string($head['description'] ?? null) && $head['description'] !== '') {
            echo '<meta name="description" content="' . esc_attr($head['description']) . "\">\n";
        }
        if (is_string($head['canonical'] ?? null) && $head['canonical'] !== '') {
            $canonical = str_starts_with($head['canonical'], '/') && !str_starts_with($head['canonical'], '//') ? home_url($head['canonical']) : $head['canonical'];
            echo '<link rel="canonical" href="' . esc_url($canonical) . "\">\n";
        }
        wp_head();
        echo "</head>\n<body class=\"" . esc_attr(implode(' ', get_body_class('first-app'))) . "\">\n";
        wp_body_open();
        echo '<div class="wp-site-blocks" data-wp-interactive="' . esc_attr(Navigation::NAMESPACE) . '" data-wp-router-region="' . esc_attr(Navigation::REGION) . '">' . $body . "</div>\n";
        wp_footer();
        echo "</body>\n</html>\n";
        exit;
    }
}
