<?php

declare(strict_types=1);

/*
 * `first/app/` on WordPress over HTTP (tests/compiler.rs `app_router_serves_pages_on_wordpress`):
 * the fixture tests/fixtures/app-router, built by `first build`, installed with every plugin active
 * and served by php -S with the theme front end on. Prints one JSON object: label => observed.
 *
 *   FIRST_WP_THEMES=1 php tests/php/app_router.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

// The webhook secret, as a wp-config constant would set it (env() reads constants first).
$site = wpSite('app', ['wpContent' => $argv[1], 'users' => ['reader' => 'subscriber', 'chief' => 'editor'],
    'muPlugins' => ['secret' => "<?php define('APPROUTER_HOOK_SECRET', 'hook-secret');"]]);
wp_set_current_user(1);
\First\db()->insert('notes', ['title' => 'Hello', 'slug' => 'hello', 'secret' => 'desk only', 'status' => 'published']);
\First\db()->insert('notes', ['title' => 'Draft', 'slug' => 'draft', 'status' => 'draft']);
$site->actAs(null);
$site->startServer();
$url = $site->url();

function fetch(string $url, string $method = 'GET', array $headers = [], ?string $body = null): array
{
    $ch = curl_init($url);
    $out = [];
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method, CURLOPT_NOBODY => $method === 'HEAD', CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => $headers, CURLOPT_POSTFIELDS => $body,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$out): int {
            if (str_contains($line, ':')) {
                [$name, $value] = explode(':', $line, 2);
                $out[strtolower(trim($name))][] = trim($value);
            }
            return strlen($line);
        },
    ]);
    $text = (string) curl_exec($ch);
    return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'headers' => $out, 'body' => $text];
}

/** The router region's contents and the document title. */
function page(array $r): array
{
    preg_match('#<title>(.*?)</title>#s', $r['body'], $t);
    preg_match('#data-wp-router-region="first/main">(.*)</div>\n#s', $r['body'], $m);
    return ['status' => $r['status'], 'title' => html_entity_decode($t[1] ?? '', ENT_QUOTES), 'body' => $m[1] ?? null];
}

// One session per user: the logged-in cookie and a REST nonce minted for the same session token,
// as a browser holds them after signing in.
$sessions = [];
$session = static function (string $user) use ($site, &$sessions): array {
    if (isset($sessions[$user])) {
        return $sessions[$user];
    }
    $id = $site->userId($user);
    $expires = time() + 3600;
    $token = WP_Session_Tokens::get_instance($id)->create($expires);
    $cookie = wp_generate_auth_cookie($id, $expires, 'logged_in', $token);
    $_COOKIE[LOGGED_IN_COOKIE] = $cookie;
    wp_set_current_user($id);
    $nonce = wp_create_nonce('wp_rest');
    wp_set_current_user(0);
    unset($_COOKIE[LOGGED_IN_COOKIE]);
    return $sessions[$user] = ['cookie' => 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode($cookie), 'nonce' => 'X-WP-Nonce: ' . $nonce];
};
$cookie = static fn (string $user): string => $session($user)['cookie'];

$home = fetch("$url/");
$out = [
    'base' => $url,
    'home' => page($home),
    'home description' => str_contains($home['body'], '<meta name="description" content="Notes.">'),
    'home cache' => $home['headers']['cache-control'] ?? null,
    'router module' => str_contains($home['body'], 'first/Render/client/router.js'),
    'note' => page(fetch("$url/notes/hello")),
    'note canonical' => (bool) preg_match('#<link rel="canonical" href="' . preg_quote($url, '#') . '/notes/hello">#', fetch("$url/notes/hello")['body']),
    // The layout's Open Graph type, card and link, with the page's image and link added.
    'note social' => (static function (string $body): array {
        preg_match_all('#<meta (?:property|name)="((?:og|twitter):[a-z]+)" content="([^"]*)">#', $body, $meta, PREG_SET_ORDER);
        preg_match_all('#<link rel="(describedby|alternate)" href="([^"]*)" type="([^"]*)">#', $body, $links, PREG_SET_ORDER);
        return ['meta' => array_map(static fn ($m) => [$m[1], html_entity_decode($m[2], ENT_QUOTES)], $meta), 'links' => array_map(static fn ($m) => array_slice($m, 1), $links)];
    })(fetch("$url/notes/hello")['body']),
    'note as editor' => page(fetch("$url/notes/hello", headers: [$cookie('chief')])),
    'draft' => page(fetch("$url/notes/draft")),
    'missing' => page(fetch("$url/notes/nope")),
    'unrouted' => page(fetch("$url/no/such/page")),
    'search' => page(fetch("$url/notes?page=3&q=tea")),
    'search defaults' => page(fetch("$url/notes?page=abc")),
    'search noindex' => str_contains(fetch("$url/notes")['body'], 'noindex'),
    'group' => page(fetch("$url/about")),
    'docs index' => page(fetch("$url/docs")),
    'docs deep' => page(fetch("$url/docs/a/b")),
    'guard anonymous' => [fetch("$url/account")['status'], str_contains((fetch("$url/account")['headers']['location'][0] ?? ''), 'wp-login.php')],
    'guard subscriber' => page(fetch("$url/account", headers: [$cookie('reader')])),
    'broken' => page(fetch("$url/broken")),
    'api' => [fetch("$url/api/notes")['status'], fetch("$url/api/notes")['body']],
    'api method' => fetch("$url/api/notes", 'DELETE')['status'],
    // A page's own POST is for subscribers (its `access`), with the REST nonce as every cookie write needs.
    'page POST anonymous' => fetch("$url/notes/hello", 'POST', ['Content-Type: application/x-www-form-urlencoded'], 'x=1')['status'],
    'page POST' => (function () use ($url, $session): array {
        $r = fetch("$url/notes/hello", 'POST', [$session('reader')['cookie'], $session('reader')['nonce']], 'x=1');
        return [$r['status'], $r['headers']['location'][0] ?? null];
    })(),
    // A signed webhook: a wrong signature is refused, the right one runs as the system (it counts the draft).
    'webhook unsigned' => fetch("$url/webhooks/notify", 'POST', [], 'ping')['status'],
    'webhook bad' => fetch("$url/webhooks/notify", 'POST', ['X-Hook-Signature: ' . str_repeat('0', 64)], 'ping')['status'],
    'webhook' => (function () use ($url): array {
        $r = fetch("$url/webhooks/notify", 'POST', ['X-Hook-Signature: ' . hash_hmac('sha256', 'ping', 'hook-secret')], 'ping');
        return [$r['status'], $r['body']];
    })(),
    'HEAD' => [fetch("$url/", 'HEAD')['status'], fetch("$url/", 'HEAD')['body']],
    // The app router must leave REST, feeds and reserved paths to WordPress.
    // Markdown twins of app pages (rendering.md §5): the page's own output, never its layout's
    // navigation, rendered as an anonymous visitor; advertised by the HTML page.
    'twin home' => [fetch("$url/index.md")['status'], fetch("$url/index.md")['body'], fetch("$url/index.md")['headers']['content-type'][0] ?? null],
    'twin note' => [fetch("$url/notes/hello.md")['status'], fetch("$url/notes/hello.md")['body']],
    'twin note as editor' => fetch("$url/notes/hello.md", headers: [$cookie('chief')])['body'],
    'twin draft' => fetch("$url/notes/draft.md")['status'],
    'twin guarded' => fetch("$url/account.md", headers: [$cookie('reader')])['status'],
    'twin link' => [fetch("$url/notes/hello")['headers']['link'] ?? [], str_contains(fetch("$url/notes/hello")['body'], '<link rel="alternate" type="text/markdown" href="' . $url . '/notes/hello.md"')],
    'llms' => fetch("$url/llms.txt")['body'],
    'rest' => fetch("$url/wp-json/")['status'],
    'feed' => fetch("$url/feed/")['status'],
    'reserved' => str_contains(fetch("$url/wp-content/nothing-here")['body'], 'No such page'),
];
echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), "\n";
$site->destroy();
