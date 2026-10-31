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
    /** @var ?array{owner: string, collection: string, postId: ?int, before: ?array, covered: ?bool, checked: bool, claimed: bool} */
    private static ?array $open = null;
    /** Inserts of the open save's collection started inside it (hooks): their ids come first. */
    private static int $nested = 0;

    public static function register(): void
    {
        add_filter('wp_insert_post_data', [self::class, 'begin'], PHP_INT_MAX, 4);
        add_action('wp_insert_post', [self::class, 'inserted'], 0, 1);
        // After fillEditorDefaults (8) and core's revision (9), before Zero's after hooks (20).
        add_action('wp_after_insert_post', [self::class, 'check'], 9, 1);
        add_action('wp_after_insert_post', [self::class, 'end'], PHP_INT_MAX, 1);
        add_action('check_admin_referer', [self::class, 'beginRestore'], 10, 2);
        add_action('wp_restore_post_revision', [self::class, 'endRestore'], PHP_INT_MAX, 1);
        register_shutdown_function([self::class, 'shutdown']);
    }

    /** Core REST create/update: the controller owns the transaction and answers a refusal itself. */
    public static function rest(string $collection, ?int $postId, callable $save): mixed
    {
        $plugin = Plugin::instance() ?? throw new \LogicException('No Zero app');
        if ($plugin->connection()->inTransaction()) {
            return $save();
        }
        self::open('rest', $collection, $postId, $postId === null ? null : $plugin->db()->editorRow($collection, $postId));
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
        self::open('core', $collection, $id > 0 ? $id : null, $id > 0 ? $plugin->db()->editorRow($collection, $id) : null);
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
            self::open('restore', $collection, $revision->post_parent, $plugin->db()->editorRow($collection, $revision->post_parent));
        }
    }

    public static function endRestore(mixed $postId): void
    {
        if (self::$open !== null && self::$open['owner'] === 'restore' && self::$open['postId'] === (int) $postId) {
            self::authorizeOrDie();
            self::commit();
        }
    }

    public static function shutdown(): void
    {
        if (self::$open === null) {
            return;
        }
        $error = error_get_last();
        $died = $error !== null && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR], true);
        if ($died || self::$open['postId'] === null) {
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
            self::rollback();
            wp_die(esc_html($e->error->getMessage()), '', ['response' => $e->error->status, 'code' => $e->error->errorCode, 'back_link' => true]);
        }
    }

    /** The save's change, as the signed-in user: field rules, then the create or update rule. */
    private static function authorize(): void
    {
        ['collection' => $collection, 'postId' => $id, 'before' => $before] = self::$open;
        $covered = self::$open['covered'];
        self::$open['checked'] = true;
        $plugin = Plugin::instance();
        if ($id === null || $plugin === null || get_current_user_id() === 0) {
            return;
        }
        $viewer = CoreAccess::viewer() ?? throw new Refused(new HttpError(403, 'suspended', 'This account is suspended'));
        $db = $plugin->db();
        $after = $db->editorRow($collection, $id);
        if ($after === null) {
            return; // not a row (an auto-draft, the trash): its capability decided
        }
        $spec = $plugin->schema->collection($collection);
        $skip = array_flip([...$plugin->editorFilled($id), $spec['primaryKey']]); // generated values are trusted
        $rules = Access::collectionRules($spec);
        try {
            if ($before === null) {
                // Supplied = what differs from an empty row with its declared defaults (a form posts every field).
                $provided = array_filter(array_diff_key($after, $skip), static fn ($v, $col) => $v !== null
                    && !(isset($spec['columns'][$col]['default']['value']) && $v === $spec['columns'][$col]['default']['value']), ARRAY_FILTER_USE_BOTH);
                $data = $after;
                FieldAccess::checkWrite('create', $collection, $data, null, $viewer, $provided);
                Access::require($rules['create'], $viewer, 'create', $after, "create $collection rows");
            } else {
                $patch = array_filter(array_diff_key($after, $skip), static fn ($v, $col) => $v !== ($before[$col] ?? null), ARRAY_FILTER_USE_BOTH);
                $data = $patch;
                FieldAccess::checkWrite('update', $collection, $data, $before, $viewer, $patch);
                $r = Access::evaluate($rules['update'], $viewer, 'update', $patch);
                if ($r === false || (is_array($r) && ($covered === false || !$db->permits($collection, 'update', $id, $viewer, $patch)))) {
                    throw Access::deny($viewer->user, "update $collection rows");
                }
            }
        } catch (HttpError $e) {
            throw new Refused($e);
        }
    }

    // ================================================================ transaction

    private static function open(string $owner, string $collection, ?int $postId, ?array $before): void
    {
        $plugin = Plugin::instance() ?? throw new \LogicException('No Zero app');
        // Whether the update rule covers the row as it is before the save: a filter must hold for the
        // row as it was (no taking over another's row) and as saved. Null when the rule, without the
        // save's data, denies: a data-dependent function rule is then judged on the saved row alone.
        $viewer = $before === null || get_current_user_id() === 0 ? null : CoreAccess::viewer();
        $covered = false;
        if ($viewer !== null && $postId !== null) {
            $plugin->app();
            $r = Access::evaluate(Access::collectionRules($plugin->schema->collection($collection))['update'], $viewer, 'update', null);
            $covered = $r === false ? null : ($r === true || $plugin->db()->permits($collection, 'update', $postId, $viewer));
        }
        $plugin->connection()->begin();
        self::$nested = 0;
        // A save opened by its own insert has claimed it; a REST create claims the first one it makes.
        self::$open = ['owner' => $owner, 'collection' => $collection, 'postId' => $postId, 'before' => $before, 'covered' => $covered,
            'checked' => false, 'claimed' => $owner === 'core'];
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
