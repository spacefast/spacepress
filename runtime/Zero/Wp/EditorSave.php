<?php

declare(strict_types=1);

namespace Zero\Wp;

use Zero\Access;
use Zero\FieldAccess;
use Zero\HttpError;

/**
 * One transaction per editor save (§3.3, §4.9). A save of a Zero post through core REST, wp-admin
 * (the edit form, quick edit, a revision restore) or any other `wp_insert_post` caller runs, with its
 * meta, SCF fields and Zero's after hooks, in one MySQL transaction opened before core writes the post.
 *
 * Before it commits, a signed-in user's save is authorized on what it actually changed: the row
 * before against the row after, whichever form field, `acf` alias or core column wrote it. Zero's
 * field write rules run on that change, then the create rule, or the update rule with that data, as
 * on `/zero/v1`. A refusal rolls the whole save back: core REST answers with Zero's 401/403 (code and
 * pointer), wp-admin with an error page. Calls with no signed-in user (WP-CLI, cron, other plugins'
 * code) are WordPress's trusted callers and are not authorized here, as on every core API.
 *
 * Owners: `rest` (PostsController wraps create/update), `restore` (wp-admin's revision restore, whose
 * SCF meta is copied after the post update), `core` (everything else, ended at wp_after_insert_post).
 * A save still open at shutdown, which happens only when its caller never fired the after hooks, is
 * authorized and committed then, unless the request died, which rolls it back.
 */
final class EditorSave
{
    /** @var ?array{owner: string, collection: string, postId: ?int, before: ?array, covers: list<string>, supplied: list<string>, checked: bool, saved: bool, claimed: bool} */
    private static ?array $open = null;
    /** Inserts of the open save's collection started inside it (hooks): their ids come first. */
    private static int $nested = 0;
    private static bool $died = false;

    public static function register(): void
    {
        add_filter('wp_insert_post_data', [self::class, 'begin'], PHP_INT_MAX, 4);
        add_action('wp_insert_post', [self::class, 'inserted'], 0, 1);
        add_action('wp_insert_post', [self::class, 'saved'], PHP_INT_MAX, 1);
        foreach (['wp_die_handler', 'wp_die_ajax_handler', 'wp_die_json_handler', 'wp_die_jsonp_handler', 'wp_die_xmlrpc_handler', 'wp_die_xml_handler'] as $filter) {
            add_filter($filter, [self::class, 'dying'], PHP_INT_MAX);
        }
        // After fillEditorDefaults (8) and core's revision (9), before Zero's after hooks (20).
        add_action('wp_after_insert_post', [self::class, 'check'], 9, 1);
        add_action('wp_after_insert_post', [self::class, 'end'], PHP_INT_MAX, 1);
        add_action('check_admin_referer', [self::class, 'beginRestore'], 10, 2);
        add_action('wp_restore_post_revision', [self::class, 'endRestore'], PHP_INT_MAX, 1);
        register_shutdown_function([self::class, 'shutdown']);
    }

    /**
     * Core REST create/update: the controller's save runs as one save, authorized before it commits;
     * a refusal answers with Zero's problem. Inside an already open transaction (a REST call made by
     * code running in one) the save is still authorized, and a refusal aborts the enclosing work.
     */
    public static function rest(string $collection, ?int $postId, \WP_REST_Request $request, callable $save): mixed
    {
        $plugin = Plugin::instance() ?? throw new \LogicException('No Zero app');
        [$declared, $supplied] = CoreAccess::incoming($collection, $request);
        $before = $postId === null ? null : $plugin->db()->editorRow($collection, $postId);
        if ($plugin->connection()->inTransaction()) {
            $outer = self::$open;
            self::$open = self::scope('rest', $collection, $postId, $before, $declared, $supplied) + ['nested' => true];
            try {
                $result = $save();
                if (!is_wp_error($result) && !self::$open['checked']) {
                    self::authorize();
                }

                return $result;
            } catch (Refused $e) {
                throw $e->error;
            } finally {
                self::$open = $outer;
            }
        }
        self::open('rest', $collection, $postId, $before, $declared, $supplied);
        try {
            $result = $save();
            if (!is_wp_error($result) && !self::$open['checked']) {
                self::authorize();
            }
        } catch (Refused $e) {
            self::rollback();

            return CoreAccess::error($e->error);
        } catch (\Throwable $e) {
            self::rollback();
            throw $e;
        }
        is_wp_error($result) ? self::rollback() : self::commit();

        return $result;
    }

    /** wp_insert_post_data: open the save of a Zero post before core writes it. */
    public static function begin(mixed $data, mixed $postarr, mixed $unsanitized = null, mixed $update = false): mixed
    {
        $plugin = Plugin::instance();
        if (!is_array($data) || $plugin === null || $plugin->connection()->busy()
            || ($collection = CoreAccess::collection((string) ($data['post_type'] ?? ''))) === null) {
            return $data;
        }
        if ($plugin->connection()->inTransaction()) {
            // A REST create's own insert is the save's post; any other insert of the collection inside
            // the open save (another plugin's save_post) is not, and learns its id first.
            if (self::$open !== null && !$update && self::$open['postId'] === null && $collection === self::$open['collection']) {
                self::$open['claimed'] ? self::$nested++ : self::$open['claimed'] = true;
            }

            return $data;
        }
        $id = $update && is_array($postarr) ? (int) ($postarr['ID'] ?? 0) : 0;
        self::open('core', $collection, $id > 0 ? $id : null, $id > 0 ? $plugin->db()->editorRow($collection, $id) : null, null, self::formSupplied($collection));
        if ($id > 0 && get_post_status($id) === 'trash') {
            self::$open['checked'] = true; // untrash: delete_post on the trashed post decided it
        }

        return $data;
    }

    /** wp_insert_post: an insert learns its post id here. */
    public static function inserted(mixed $postId): void
    {
        if (self::$open === null || self::$open['postId'] !== null || self::busy()
            || CoreAccess::collection((string) get_post_type((int) $postId)) !== self::$open['collection']) {
            return;
        }
        if (self::$nested > 0) {
            self::$nested--;

            return;
        }
        self::$open['postId'] = (int) $postId;
    }

    /** wp_insert_post (last): core has written the post and its meta; a save left open is complete. */
    public static function saved(mixed $postId): void
    {
        if (self::$open !== null && !self::busy() && self::$open['postId'] === (int) $postId) {
            self::$open['saved'] = true;
        }
    }

    public static function check(mixed $post): void
    {
        if (self::$open !== null && self::$open['owner'] !== 'restore' && !self::$open['checked'] && self::owns($post)) {
            self::authorizeOrDie();
        }
    }

    public static function end(mixed $post): void
    {
        if (self::$open !== null && self::$open['owner'] === 'core' && self::owns($post)) {
            if (!self::$open['checked']) {
                self::authorizeOrDie();
            }
            self::commit();
        }
    }

    /** wp-admin's revision.php checks its nonce, then restores: the save opens here. */
    public static function beginRestore(mixed $action, mixed $result): void
    {
        $plugin = Plugin::instance();
        if ($plugin === null || $result === false || !is_string($action) || !str_starts_with($action, 'restore-post_')
            || $plugin->connection()->inTransaction()) {
            return;
        }
        $revision = wp_get_post_revision((int) substr($action, strlen('restore-post_')));
        $collection = $revision instanceof \WP_Post ? CoreAccess::collection((string) get_post_type($revision->post_parent)) : null;
        if ($collection !== null) {
            self::open('restore', $collection, $revision->post_parent, $plugin->db()->editorRow($collection, $revision->post_parent), null, []);
        }
    }

    public static function endRestore(mixed $postId): void
    {
        if (self::$open !== null && self::$open['owner'] === 'restore' && self::$open['postId'] === (int) $postId) {
            self::authorizeOrDie();
            self::commit();
        }
    }

    /**
     * A save still open at shutdown commits only if core completed it (its `wp_insert_post` fired)
     * and the request didn't die meanwhile (wp_die, a fatal error); anything else rolls back.
     */
    public static function shutdown(): void
    {
        if (self::$open === null) {
            return;
        }
        $error = error_get_last();
        $died = self::$died || ($error !== null && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR], true));
        if ($died || !self::$open['saved'] || self::$open['owner'] !== 'core') {
            self::rollback();

            return;
        }
        try {
            if (!self::$open['checked']) {
                self::authorize();
            }
            self::commit();
        } catch (Refused $e) {
            self::rollback();
            error_log('[zero] refused an editor save at shutdown: ' . $e->error->getMessage());
        }
    }

    /** wp_die handler filters: a request that dies leaves its open save uncommitted. */
    public static function dying(mixed $handler): mixed
    {
        self::$died = true;

        return $handler;
    }

    /** A Zero after hook threw inside an open save: nothing of it may commit. */
    public static function abort(): void
    {
        if (self::$open !== null) {
            self::rollback();
        }
    }

    // ================================================================ authorization

    private static function authorizeOrDie(): void
    {
        try {
            self::authorize();
        } catch (Refused $e) {
            if (self::$open['owner'] === 'rest') {
                throw $e;
            }
            if (self::$open['nested'] ?? false) {
                throw $e->error;
            }
            self::rollback();
            wp_die(esc_html($e->error->getMessage()), '', ['response' => $e->error->status, 'code' => $e->error->errorCode, 'back_link' => true]);
        }
    }

    /**
     * The save as the signed-in user wrote it: the columns it supplied (form fields, `acf` selectors and
     * aliases, core columns) and every column it changed, with their saved values. Field write rules
     * run on those, as on `/zero/v1` (an unchanged hidden value is still refused, so no value can be
     * probed), then the create rule, or the update rule with that data: a filter must match the row
     * as it was before the save, as the API's update selector does.
     */
    private static function authorize(): void
    {
        $open = self::$open;
        self::$open['checked'] = true;
        $plugin = Plugin::instance();
        if ($open['postId'] === null || $plugin === null || get_current_user_id() === 0) {
            return;
        }
        ['collection' => $collection, 'postId' => $id, 'before' => $before] = $open;
        $viewer = CoreAccess::viewer() ?? throw new Refused(new HttpError(403, 'suspended', 'This account is suspended'));
        $after = $plugin->db()->editorRow($collection, $id);
        if ($after === null) {
            return; // not a row (an auto-draft, the trash): its capability decided
        }
        $spec = $plugin->schema->collection($collection);
        $generated = array_flip([...$plugin->editorFilled($id), $spec['primaryKey']]); // trusted, not input
        $rules = Access::collectionRules($spec);
        try {
            if ($before === null) {
                // A form posts every field: supplied = named by the request, or not the column's default.
                $cols = array_filter(array_diff_key($after, $generated), static fn ($v, $col) => in_array($col, $open['supplied'], true)
                    || ($v !== null && !(isset($spec['columns'][$col]['default']['value']) && $v === $spec['columns'][$col]['default']['value'])), ARRAY_FILTER_USE_BOTH);
                $data = $after;
                FieldAccess::checkWrite('create', $collection, $data, null, $viewer, $cols);
                Access::require($rules['create'], $viewer, 'create', $after, "create $collection rows");

                return;
            }
            $changed = array_keys(array_filter(array_diff_key($after, $generated), static fn ($v, $col) => $v !== ($before[$col] ?? null), ARRAY_FILTER_USE_BOTH));
            $patch = array_intersect_key($after, array_flip([...$changed, ...$open['supplied']]));
            $data = $patch;
            FieldAccess::checkWrite('update', $collection, $data, $before, $viewer, $patch);
            $r = Access::evaluate($rules['update'], $viewer, 'update', $patch);
            if ($r === false || (is_array($r) && !in_array(serialize($r), $open['covers'], true))) {
                throw Access::deny($viewer->user, "update $collection rows");
            }
        } catch (HttpError $e) {
            throw new Refused($e);
        }
    }

    /** Top-level columns a wp-admin form or quick edit names (SCF field keys, core columns). */
    private static function formSupplied(string $collection): array
    {
        if (!is_admin() && !wp_doing_ajax()) {
            return [];
        }
        $spec = Plugin::instance()?->schema->collection($collection) ?? [];
        $cols = [];
        foreach (array_keys(is_array($_POST['acf'] ?? null) ? $_POST['acf'] : []) as $key) {
            foreach ($spec['columns'] ?? [] as $col => $_) {
                if ($key === $spec['wp']['fieldKeyPrefix'] . $col) {
                    $cols[] = (string) $col;
                }
            }
        }
        foreach (['post_title' => 'title', 'content' => 'content', 'post_name' => 'slug'] as $param => $designation) {
            if (isset($_POST[$param]) && ($spec[$designation] ?? null) !== null) {
                $cols[] = $spec[$designation];
            }
        }

        return $cols;
    }

    // ================================================================ transaction

    private static function open(string $owner, string $collection, ?int $postId, ?array $before, ?array $declared, array $supplied): void
    {
        $scope = self::scope($owner, $collection, $postId, $before, $declared, $supplied);
        Plugin::instance()?->connection()->begin();
        self::$nested = 0;
        self::$died = false;
        self::$open = $scope;
    }

    /**
     * A save's state. `covers`: the update-rule filters (serialized) that match the row as it is
     * before the save, for the rule evaluated without data and with the request's declared data.
     */
    private static function scope(string $owner, string $collection, ?int $postId, ?array $before, ?array $declared, array $supplied): array
    {
        $plugin = Plugin::instance() ?? throw new \LogicException('No Zero app');
        $covers = [];
        $viewer = $before === null || get_current_user_id() === 0 ? null : CoreAccess::viewer();
        if ($viewer !== null && $postId !== null) {
            $plugin->app();
            $rule = Access::collectionRules($plugin->schema->collection($collection))['update'];
            foreach ($declared === null ? [null] : [null, $declared] as $data) {
                $r = Access::evaluate($rule, $viewer, 'update', $data);
                if (is_array($r) && $plugin->db()->permits($collection, 'update', $postId, $viewer, $data)) {
                    $covers[] = serialize($r);
                }
            }
        }

        // A save opened by its own insert has claimed it; a REST create claims the first one it makes.
        return ['owner' => $owner, 'collection' => $collection, 'postId' => $postId, 'before' => $before, 'covers' => $covers,
            'supplied' => array_values(array_unique($supplied)), 'checked' => false, 'saved' => false, 'claimed' => $owner === 'core'];
    }

    private static function commit(): void
    {
        self::$open = null;
        Plugin::instance()?->connection()->commit();
    }

    private static function rollback(): void
    {
        $postId = self::$open['postId'] ?? null;
        self::$open = null;
        Plugin::instance()?->connection()->rollback();
        if ($postId !== null) {
            clean_post_cache($postId); // core wrote it outside Zero's store: no cache may keep a ghost
        }
        CoreAccess::flush();
    }

    private static function owns(mixed $post): bool
    {
        $id = $post instanceof \WP_Post ? $post->ID : (int) $post;

        return !self::busy() && self::$open['postId'] === $id;
    }

    private static function busy(): bool
    {
        return Plugin::instance()?->connection()->busy() ?? false;
    }
}
