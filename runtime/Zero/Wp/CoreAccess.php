<?php

declare(strict_types=1);

namespace Zero\Wp;

use Zero\Access;
use Zero\FieldAccess;
use Zero\HttpError;
use Zero\Schema;
use Zero\Viewer;

/**
 * Core `/wp/v2/zero_*` and wp-admin under Zero's access rules. Core REST stays enabled for the block
 * editor, but it is never a second API around Zero's rules:
 *
 * - capabilities: `map_meta_cap` answers every capability of a Zero post type from the collection's
 *   rules, for the user being asked about (role caps no longer decide). Per post: `read_post` = the
 *   read rule (+ draft visibility), `edit_post`/`publish_post` = update (create on an auto-draft, which
 *   is not a row yet), `delete_post` = delete. Type-wide caps (menus, create buttons, status changes)
 *   ask whether the rule could allow anything. Writes always need a signed-in, unsuspended user; a
 *   trashed post (not a Zero row) needs a rule that covers every row.
 * - reads ({@see PostsController}): lists hold only rows the read rule covers, a rule that denies is
 *   401/403, a filtered-out item is 404, and every response drops the fields the viewer can't read.
 * - writes ({@see PostsController}): the supplied core columns and `acf` fields go through Zero's field
 *   write rules, then the create rule (or the update rule) sees the incoming data, as on `/zero/v1`.
 */
final class CoreAccess
{
    private const META = ['read_post', 'edit_post', 'publish_post', 'delete_post'];
    private const STRUCTURED = ['group', 'repeater', 'blocks'];

    /** @var ?array<string, array{string, string}> primitive cap => [collection, kind] */
    private static ?array $primitives = null;
    /** @var array<string, ?list<int|string>|false> "collection op user" => keys (null = all, false = denied) */
    private static array $keys = [];

    public static function register(): void
    {
        add_filter('map_meta_cap', [self::class, 'mapMetaCap'], 10, 4);
        add_filter('rest_prepare_revision', [self::class, 'prepareChild'], 10, 3);
        add_filter('rest_prepare_autosave', [self::class, 'prepareChild'], 10, 3);
        add_action('pre_get_posts', [self::class, 'adminList']);
        add_filter('acf/prepare_field', [self::class, 'formField'], 20);
        add_filter('acf/pre_update_value', [self::class, 'formSave'], 5, 4);
        // A save or delete changes what a rule covers; a user switch changes who asks.
        add_action('clean_post_cache', static function (): void {
            self::$keys = [];
        });
        add_action('set_current_user', static function (): void {
            self::$keys = [];
        });
    }

    // ================================================================ capabilities

    /** @param list<string> $caps */
    public static function mapMetaCap(array $caps, string $cap, int $userId, array $args): array
    {
        $plugin = Plugin::instance();
        if ($plugin === null) {
            return $caps;
        }
        if (in_array($cap, self::META, true)) {
            $post = isset($args[0]) ? get_post((int) $args[0]) : null;
            if ($post instanceof \WP_Post && $post->post_type === 'revision') {
                if ($cap === 'delete_post') {
                    return $caps; // core never deletes a revision through delete_post
                }
                $post = get_post($post->post_parent);
            }
            $collection = $post instanceof \WP_Post ? self::collection($post->post_type) : null;
            if ($collection === null) {
                return $caps;
            }

            return self::grant(self::postAllowed($collection, $cap, $post, $userId));
        }
        [$collection, $kind] = self::primitives()[$cap] ?? [null, null];
        if ($collection === null) {
            return $caps;
        }

        return self::grant(self::typeAllowed($collection, $kind, $userId));
    }

    private static function postAllowed(string $collection, string $cap, \WP_Post $post, int $userId): bool
    {
        $viewer = self::viewerFor($userId);
        if ($viewer === null || ($cap !== 'read_post' && $viewer->user === null)) {
            return false;
        }
        if ($post->post_status === 'auto-draft') {
            return $cap !== 'read_post' && self::ruleMayAllow($collection, 'create', $viewer);
        }
        $op = ['read_post' => 'read', 'edit_post' => 'update', 'publish_post' => 'update', 'delete_post' => 'delete'][$cap];
        if ($post->post_status === 'trash') {
            return self::keys($collection, $op === 'read' ? 'update' : $op, $viewer) === null;
        }

        return self::covers($collection, $op, $post->ID, $viewer);
    }

    private static function typeAllowed(string $collection, string $kind, int $userId): bool
    {
        $viewer = self::viewerFor($userId);
        if ($viewer === null) {
            return false;
        }
        if ($kind === 'readAll') {
            return self::keys($collection, 'read', $viewer) === null;
        }
        if ($viewer->user === null) {
            return false;
        }

        return match ($kind) {
            'create' => self::ruleMayAllow($collection, 'create', $viewer),
            'edit' => self::ruleMayAllow($collection, 'update', $viewer) || self::ruleMayAllow($collection, 'create', $viewer),
            'update' => self::ruleMayAllow($collection, 'update', $viewer),
            'delete' => self::ruleMayAllow($collection, 'delete', $viewer),
        };
    }

    /** @return array<string, array{string, string}> */
    private static function primitives(): array
    {
        if (self::$primitives === null) {
            self::$primitives = [];
            foreach (self::postBacked() as $name => $spec) {
                $t = $spec['wp']['postType'];
                self::$primitives += [
                    "create_$t" => [$name, 'create'],
                    "edit_$t" => [$name, 'edit'],
                    "publish_$t" => [$name, 'edit'],
                    "edit_others_$t" => [$name, 'update'], "edit_published_$t" => [$name, 'update'], "edit_private_$t" => [$name, 'update'],
                    "delete_$t" => [$name, 'delete'], "delete_others_$t" => [$name, 'delete'],
                    "delete_published_$t" => [$name, 'delete'], "delete_private_$t" => [$name, 'delete'],
                    "read_private_$t" => [$name, 'readAll'],
                ];
            }
        }

        return self::$primitives;
    }

    /** @param list<string> $caps */
    private static function grant(bool $allowed): array
    {
        return [$allowed ? 'exist' : 'do_not_allow'];
    }

    /** True unless the rule denies this viewer outright (a filter or a data-dependent rule may allow). */
    private static function ruleMayAllow(string $collection, string $op, Viewer $viewer): bool
    {
        Plugin::instance()?->app(); // function rules live in the app's functions.php
        try {
            return Access::evaluate(Access::collectionRules(self::schema()->collection($collection))[$op], $viewer, $op, null) !== false;
        } catch (\Throwable) {
            return false;
        }
    }

    /** Does the viewer's $op rule cover row $pk (as stored, without a write's data)? */
    public static function covers(string $collection, string $op, int|string $pk, Viewer $viewer): bool
    {
        $keys = self::keys($collection, $op, $viewer);

        return $keys === null || ($keys !== false && in_array((int) $pk, array_map('intval', $keys), true));
    }

    /**
     * Rows the viewer's read or update rule covers: null = every row, false = the rule denies,
     * else their primary keys. Cached per request until a post changes.
     *
     * @return ?list<int|string>|false
     */
    public static function keys(string $collection, string $op, Viewer $viewer): array|null|false
    {
        $key = $collection . ' ' . $op . ' ' . ($viewer->user['id'] ?? 0);
        if (!array_key_exists($key, self::$keys)) {
            try {
                self::$keys[$key] = Plugin::instance()?->db()->permittedKeys($collection, $op, $viewer);
            } catch (HttpError) {
                self::$keys[$key] = false;
            }
        }

        return self::$keys[$key];
    }

    // ================================================================ viewers

    /** The viewer of this request (null when the account is suspended). */
    public static function viewer(): ?Viewer
    {
        return self::viewerFor(get_current_user_id());
    }

    private static function viewerFor(int $userId): ?Viewer
    {
        $user = $userId > 0 ? get_userdata($userId) : false;
        if (!$user instanceof \WP_User) {
            return new Viewer(null, 'wp');
        }
        if (IdentityBridge::suspended($userId)) {
            return null;
        }

        return new Viewer(WpAuth::map($user), 'wp');
    }

    // ================================================================ reads

    /** The read rule's own refusal for this viewer (401/403), or null when it may allow rows. */
    public static function readDenial(string $collection, ?Viewer $viewer): ?\WP_Error
    {
        if ($viewer === null) {
            return self::error(new HttpError(403, 'suspended', 'This account is suspended'));
        }
        if (self::keys($collection, 'read', $viewer) === false) {
            return self::error(Access::deny($viewer->user, "read $collection"));
        }

        return null;
    }

    /** Drop from a core response every field the viewer can't read on post $id. */
    public static function strip(mixed $response, string $collection, int $id, ?Viewer $viewer): mixed
    {
        if (!$response instanceof \WP_REST_Response || !is_array($data = $response->get_data())) {
            return $response;
        }
        $plugin = Plugin::instance();
        $stored = $plugin?->db()->editorRow($collection, $id);
        if ($stored === null) {
            return $response;
        }
        $spec = self::schema()->collection($collection);
        $visible = $viewer === null ? [] : (FieldAccess::strip([$stored], $collection, $viewer)[0] ?? []);
        foreach ($spec['columns'] as $col => $def) {
            $col = (string) $col;
            $hidden = array_key_exists($col, $stored) && !array_key_exists($col, $visible);
            // A structured value with a hidden sub-field is dropped whole: core shows SCF's own shape.
            if (!$hidden && in_array($def['type'], self::STRUCTURED, true) && array_key_exists($col, $stored)) {
                $hidden = $visible[$col] !== $stored[$col];
            }
            if (!$hidden || $col === $spec['primaryKey'] || ($def['system'] ?? false)) {
                continue;
            }
            match ($col) {
                $spec['content'] ?? null => self::unset($data, ['content', 'excerpt']),
                $spec['slug'] ?? null => self::unset($data, ['slug', 'generated_slug', 'permalink_template']),
                $spec['title'] ?? null => null, // always readable (§4.4)
                default => is_array($data['acf'] ?? null) ? self::unset($data['acf'], [$spec['wp']['metaPrefix'] . $col, $spec['wp']['metaPrefix'] . $col . '_source']) : null,
            };
        }
        $response->set_data($data);

        return $response;
    }

    /** Revisions and autosaves of a Zero post are stripped by the live row's rules. */
    public static function prepareChild(mixed $response, mixed $post, mixed $request): mixed
    {
        if (!$post instanceof \WP_Post || $post->post_parent <= 0) {
            return $response;
        }
        $collection = self::collection((string) get_post_type($post->post_parent));

        return $collection === null ? $response : self::strip($response, $collection, $post->post_parent, self::viewer());
    }

    private static function unset(array &$data, array $keys): void
    {
        foreach ($keys as $k) {
            unset($data[$k]);
        }
    }

    /** wp-admin lists of a Zero post type hold only the rows the viewer's read rule covers. */
    public static function adminList(\WP_Query $query): void
    {
        if (!is_admin() || wp_doing_ajax() || !$query->is_main_query() || !is_string($type = $query->get('post_type'))
            || ($collection = self::collection($type)) === null) {
            return;
        }
        $viewer = self::viewer();
        $keys = $viewer === null ? false : self::keys($collection, 'read', $viewer);
        if (is_array($keys) || $keys === false) {
            $query->set('post__in', $keys === false || $keys === [] ? [0] : array_map('intval', $keys));
        }
    }

    // ================================================================ wp-admin form

    /** The edit screen doesn't render a top-level field the viewer can't read on this post. */
    public static function formField(mixed $field): mixed
    {
        if (!is_array($field) || empty($field['zero_top']) || !is_admin()) {
            return $field;
        }
        $context = self::formContext((int) (acf_get_form_data('post_id') ?: 0), $field);

        return $context !== null && !self::fieldAllows($context, 'read') ? false : $field;
    }

    /**
     * A wp-admin form save skips a top-level field the viewer can't set (Zero's own writes, core REST
     * and trusted code are decided elsewhere): the stored value stays.
     */
    public static function formSave(mixed $check, mixed $value, mixed $postId, mixed $field): mixed
    {
        if ($check !== null || Scf::$io > 0 || !is_array($field) || empty($field['zero_top'])
            || (defined('REST_REQUEST') && REST_REQUEST) || !is_numeric($postId) || get_current_user_id() === 0) {
            return $check;
        }
        $context = self::formContext((int) $postId, $field);
        if ($context === null) {
            return $check;
        }
        $op = $context[3] === null ? 'create' : 'update';

        return self::fieldAllows($context, $op) && ($op === 'create' || self::fieldAllows($context, 'read')) ? $check : true;
    }

    /** @return ?array{array, string, Viewer, ?array} [column def, collection, viewer, stored row] */
    private static function formContext(int $postId, array $field): ?array
    {
        $collection = $postId > 0 ? self::collection((string) get_post_type($postId)) : null;
        $col = $field['zero']['name'] ?? null;
        $viewer = self::viewer();
        if ($collection === null || !is_string($col) || $viewer === null) {
            return null;
        }
        $def = self::schema()->collection($collection)['columns'][$col] ?? null;
        if ($def === null || !isset($def['access'])) {
            return null;
        }
        $post = get_post($postId);
        $stored = $post instanceof \WP_Post && $post->post_status !== 'auto-draft' ? Plugin::instance()?->db()->editorRow($collection, $postId) : null;

        return [$def, $collection, $viewer, $stored];
    }

    private static function fieldAllows(array $context, string $op): bool
    {
        [$def, , $viewer, $stored] = $context;
        $rule = $def['access'][$op] ?? null;
        Plugin::instance()?->app();
        try {
            return $rule === null || Access::evaluate($rule, $viewer, $op, $stored ?? []) === true;
        } catch (\Throwable) {
            return false;
        }
    }

    // ================================================================ writes

    /**
     * Zero's write checks for a core create (null $postId, or an auto-draft) or update: field write
     * rules on the supplied values, then the collection's create rule, or update rule, with the data.
     */
    public static function checkWrite(string $collection, \WP_REST_Request $request, ?int $postId): ?\WP_Error
    {
        if (!in_array($request->get_method(), ['POST', 'PUT', 'PATCH'], true)) {
            return null; // core asks while building a GET's Allow header: capabilities answered that
        }
        $viewer = self::viewer();
        if ($viewer === null || $viewer->user === null) {
            return self::error($viewer === null ? new HttpError(403, 'suspended', 'This account is suspended') : Access::deny(null, "write $collection rows"));
        }
        $db = Plugin::instance()?->db();
        $existing = $postId === null || $db === null ? null : $db->editorRow($collection, $postId);
        $data = self::incoming($collection, $request);
        $rules = Access::collectionRules(self::schema()->collection($collection));
        try {
            if ($existing === null) {
                FieldAccess::checkWrite('create', $collection, $data, null, $viewer, $data);
                Access::require($rules['create'], $viewer, 'create', $data, "create $collection rows");
            } else {
                FieldAccess::checkWrite('update', $collection, $data, $existing, $viewer, $data);
                if (!$db->permits($collection, 'update', $postId, $viewer, $data)) {
                    throw Access::deny($viewer->user, "update $collection rows");
                }
            }
        } catch (HttpError $e) {
            return self::error($e);
        }

        return null;
    }

    /** The Zero row a core request supplies (JS form): core columns and top-level `acf` fields. */
    private static function incoming(string $collection, \WP_REST_Request $request): array
    {
        $spec = self::schema()->collection($collection);
        $data = [];
        foreach (['title' => $spec['title'] ?? null, 'content' => $spec['content'] ?? null, 'slug' => $spec['slug'] ?? null] as $param => $col) {
            if ($col !== null && $request->has_param($param)) {
                $v = $request->get_param($param);
                $data[$col] = is_array($v) ? ($v['raw'] ?? null) : $v;
            }
        }
        if (($spec['drafts'] ?? false) && is_string($status = $request->get_param('status'))) {
            $data['status'] = ['publish' => 'published', 'future' => 'scheduled'][$status] ?? 'draft';
        }
        $acf = $request->get_param('acf');
        if (is_array($acf)) {
            foreach ($spec['columns'] as $col => $def) {
                $col = (string) $col;
                $key = $spec['wp']['fieldKeyPrefix'] . $col;
                foreach ([$spec['wp']['metaPrefix'] . $col, $key] as $name) {
                    if (array_key_exists($name, $acf)) {
                        $data[$col] = Scf::fromScf($def, $acf[$name], $key);
                        break;
                    }
                }
            }
        }

        return $data;
    }

    // ================================================================ helpers

    public static function error(HttpError $e): \WP_Error
    {
        return new \WP_Error($e->errorCode, $e->getMessage(), ['status' => $e->status] + ($e->pointer === null ? [] : ['pointer' => $e->pointer]));
    }

    public static function collection(string $postType): ?string
    {
        foreach (self::postBacked() as $name => $spec) {
            if ($spec['wp']['postType'] === $postType) {
                return (string) $name;
            }
        }

        return null;
    }

    /** @return array<string, array> */
    private static function postBacked(): array
    {
        $schema = Plugin::instance()?->schema;

        return $schema === null ? [] : array_filter($schema->collections(), static fn (array $c) => ($c['editor'] ?? true) && ($c['wp'] ?? null) !== null);
    }

    private static function schema(): Schema
    {
        return Plugin::instance()?->schema ?? throw new \LogicException('No Zero app');
    }
}
