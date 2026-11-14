<?php

declare(strict_types=1);

namespace First\Wp;

use First\Access;
use First\HttpError;
use First\Schema;
use First\Viewer;

/**
 * The site's users aren't listed to the public (spec.md §6). WordPress ships with several ways for a
 * visitor to enumerate them, each showing a login or the display name WordPress fills from it:
 * `/wp/v2/users` and `/wp/v2/users/<id>` (and every embed of a post's author, which dispatches the
 * same route), `?author=<id>` (which redirects to `/author/<login>/`), author archives and their
 * feeds and Markdown twins, the users sitemap, and the author fields of a post's oEmbed. While a First
 * app is active they are closed, unless the app makes its authors public: `publicAuthors: true` in the
 * config, or a users kind whose read rule lets anyone read users.
 *
 * A users kind whose read rule gives a signed-out visitor some users' rows makes those users public
 * authors, one by one ({@see visible()}): their archive, `?author=<id>`, sitemap entry (narrowed by
 * {@see Sitemap}) and oEmbed fields answer as WordPress ships them, and every other user's stay
 * closed. Core's `/wp/v2/users` stays closed either way; First's API serves the kind.
 *
 * Signed-in users keep core's answers on the REST routes (the block editor lists authors), and the
 * users kind's own rules decide what First's API shows ({@see UserMeta}). Nothing is written.
 */
final class Authors
{
    private const USERS = '#^/wp/v2/users(/|$)#i';

    private static ?bool $public = null;

    public static function apply(Schema $schema): void
    {
        add_filter('rest_pre_dispatch', static fn (mixed $result, mixed $server, mixed $request): mixed => self::route($schema, $result, $request), 5, 3);
        add_filter('request', static fn (array $vars): array => self::archive($schema, $vars), PHP_INT_MAX);
        // With a users kind the sitemap stays and lists only the users a visitor may read ({@see Sitemap}).
        add_filter('wp_sitemaps_add_provider', static fn (mixed $provider, string $name): mixed => $name === 'users' && !self::public($schema) && self::kind($schema) === null ? false : $provider, 10, 2);
        add_filter('oembed_response_data', static function (mixed $data, mixed $post = null) use ($schema): mixed {
            if (!is_array($data) || self::visible($schema, $post instanceof \WP_Post ? (int) $post->post_author : 0)) {
                return $data;
            }

            // Core's own answer for a post with no author: the site's name and address.
            return ['author_name' => get_bloginfo('name'), 'author_url' => get_home_url()] + $data;
        }, PHP_INT_MAX, 2);
    }

    /** The app's users kind, or null when it has none. */
    private static function kind(Schema $schema): ?string
    {
        $users = $schema->auth()['collection'] ?? null;

        return is_string($users) ? $users : null;
    }

    /** Whether the app makes its authors public: the config's flag, or a users kind anyone may read. */
    public static function public(Schema $schema): bool
    {
        if (self::$public === null) {
            $users = self::kind($schema);
            $rule = $users === null ? null : Access::collectionRules($schema->collection($users))['read'];
            self::$public = $schema->publicAuthors()
                || ($rule !== null && Access::isShorthand($rule) && Access::evaluate($rule, new Viewer(null), 'read') === true);
        }

        return self::$public;
    }

    /**
     * Whether a signed-out visitor may see this user as an author: the app's authors are public, or
     * its users kind's read rule gives a visitor that user's row. While storage is behind the build
     * the rule can't be asked, so nobody is.
     */
    public static function visible(Schema $schema, int $user): bool
    {
        if (self::public($schema)) {
            return true;
        }
        $users = self::kind($schema);
        $plugin = Plugin::instance();
        if ($users === null || $user <= 0 || $plugin === null || $plugin->unavailable() !== null) {
            return false;
        }
        try {
            return $plugin->db()->findFirst($users, ['where' => ['id' => $user]], new Viewer(null)) !== null;
        } catch (HttpError) {
            return false; // the rule refuses signed-out visitors
        }
    }

    /**
     * rest_pre_dispatch: a visitor who isn't signed in reads no user from core's routes, listed or one
     * by one, directly, through `?rest_route=`, a batch or an embed. Core answers a signed-out request
     * for a user it won't show this way.
     *
     * One case is left to its own rule: First's API reading an app's users kind. There First selects
     * the rows by the kind's read rule and returns its own row for each ({@see UserMeta}), so a
     * signed-out visitor gets what that rule gives anyone, which is nothing unless the app says so.
     */
    private static function route(Schema $schema, mixed $result, mixed $request): mixed
    {
        if ($result !== null || !$request instanceof \WP_REST_Request || !preg_match(self::USERS, $request->get_route())
            || is_user_logged_in() || self::public($schema) || self::ruled($schema, $request)) {
            return $result;
        }

        return new \WP_Error('rest_user_cannot_view', __('Sorry, you are not allowed to list users.'), ['status' => rest_authorization_required_code()]);
    }

    /**
     * Whether this is First's API reading the app's users kind, where the kind's read rule decides. A
     * list is the rule's to answer: its own 401 when it needs a signed-in user, else the rows it gives
     * a signed-out viewer. One user is passed on only when the rule
     * gives that row to a signed-out viewer; every other id, real or not, gets the same 401, so the
     * answer doesn't say which ids exist.
     */
    private static function ruled(Schema $schema, \WP_REST_Request $request): bool
    {
        if (self::kind($schema) === null || !Facade::dispatching() || $request->get_method() !== 'GET') {
            return false;
        }
        $route = strtolower(untrailingslashit($request->get_route()));
        if ($route === '/wp/v2/users') {
            return true;
        }

        return preg_match('#^/wp/v2/users/(\d+)$#', $route, $m) === 1 && self::visible($schema, (int) $m[1]);
    }

    /**
     * request: an author archive (`/author/<login>/`, `?author=<id>`, `?author_name=`, their feeds and
     * Markdown twins) is a 404, before core resolves it or redirects `?author=<id>` to the login,
     * unless it names one user a visitor may see as an author ({@see visible()}). Every other form
     * (a list of ids, an excluded id, a login nobody has) gets the same 404.
     *
     * @param array<string, mixed> $vars
     * @return array<string, mixed>
     */
    private static function archive(Schema $schema, array $vars): array
    {
        if ((!isset($vars['author']) && !isset($vars['author_name'])) || self::public($schema) || is_admin()) {
            return $vars;
        }
        $named = [];
        if (isset($vars['author'])) {
            $id = is_scalar($vars['author']) ? (string) $vars['author'] : '';
            $named[] = ctype_digit($id) ? (int) $id : 0;
        }
        if (isset($vars['author_name'])) {
            // As core reads it: the last segment of the path, as a user's nicename.
            $parts = is_string($vars['author_name']) ? array_values(array_filter(explode('/', $vars['author_name']), static fn (string $p): bool => $p !== '')) : [];
            $user = $parts === [] ? false : get_user_by('slug', sanitize_title_for_query($parts[count($parts) - 1]));
            $named[] = $user instanceof \WP_User ? (int) $user->ID : 0;
        }
        foreach ($named as $id) {
            if (!self::visible($schema, $id)) {
                return ['error' => '404'];
            }
        }

        return $vars;
    }
}
