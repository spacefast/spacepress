<?php

declare(strict_types=1);

namespace First\Wp;

use First\HttpError;
use First\Js;
use First\Viewer;

/**
 * Revision tokens and edit locks for post kinds with staged versions (docs/staged.md).
 *
 * `_rev` is an opaque token of the item as a read saw it. An item read carries the **live** token:
 * the post row and its First meta, the same for every reader, so it never says whether anything is
 * staged. A staged version read carries the **staged** token: the live state plus the staged
 * revision. With nothing staged the two are the same, so the item's own `_rev` starts a stage.
 *
 * A write that names a token the item no longer has is refused with `409 stale_revision`: the item's
 * PATCH and DELETE take the live token, stage, promote, discard and a scheduled promote the staged
 * one. The problem says what changed since (the fields, as the caller may read them, and whether
 * the staged version changed) and carries the current token. Leaving `_rev` out is an
 * unconditional write, as on core's own routes.
 *
 * The edit lock is core's: `_edit_lock` and `wp_check_post_lock()`, which the block editor and the
 * classic editor set and refresh. While another user holds it, the item's writes are refused with
 * `409 locked` naming the holder, on the API, through abilities, and on core REST's item routes for
 * the kind. `takeover: true` (`?takeover=1` on a DELETE) takes the lock first, as the editor's "Take
 * over" button does; it needs the item's update rule like every write. Both checks run only for a
 * caller the item's update rule covers, so nobody else learns of a lock, a token or its holder.
 */
final class Rev
{
    public const FIELD = '_rev';
    public const TAKEOVER = 'takeover';

    /** The item's live token (what an item read carries), or null for a kind without staged versions. */
    public static function live(string $collection, int $id): ?string
    {
        $state = self::state($collection, $id);

        return $state === null ? null : self::encode($state, false);
    }

    /** The token a staged version read carries: the live state and the staged revision. */
    public static function staged(string $collection, int $id): ?string
    {
        $state = self::state($collection, $id);

        return $state === null ? null : self::encode($state, true);
    }

    /** $row with its live `_rev`, for a kind with staged versions; any other row as it is. */
    public static function attach(string $collection, mixed $row): mixed
    {
        $spec = Plugin::instance()?->schema->hasCollection($collection) ? Plugin::instance()->schema->collection($collection) : null;
        $pk = $spec['primaryKey'] ?? 'id';
        if (!is_array($row) || $spec === null || !Staged::enabled($spec) || !isset($row[$pk])) {
            return $row;
        }
        $token = self::live($collection, (int) $row[$pk]);

        return $token === null ? $row : $row + [self::FIELD => $token];
    }

    /**
     * Take `_rev` and `takeover` out of a request body: they are the write's conditions, not fields.
     *
     * @return array{array, mixed, bool} [the body without them, `_rev` (null when not sent), takeover]
     */
    public static function split(array $body): array
    {
        $rev = $body[self::FIELD] ?? null;
        $takeover = $body[self::TAKEOVER] ?? false;
        if ($takeover !== false && $takeover !== true) {
            throw HttpError::invalidInput('takeover must be true or false', '/' . self::TAKEOVER);
        }
        unset($body[self::FIELD], $body[self::TAKEOVER]);

        return [$body, $rev, $takeover];
    }

    /**
     * Refuse a write to item $id when another user holds its edit lock (unless $takeover), or when
     * $expected (null: not sent) is not its current token. $staged: the token covers the staged
     * version too. Call it inside the write's transaction, after the item's row lock
     * ({@see WpPostStore::stagedLock()}), so nothing changes between this check and the write.
     * A caller the item's update rule doesn't cover is left to the write, which refuses it as it
     * refuses anyone: neither the lock nor the token is theirs to learn about.
     */
    public static function require(string $collection, int $id, mixed $expected, bool $takeover, ?Viewer $viewer, bool $staged = false, ?array $data = null): void
    {
        $state = self::state($collection, $id);
        if ($state === null) {
            return;
        }
        if ($viewer !== null && !CoreAccess::covers($collection, 'update', $id, $viewer)
            && !(Plugin::instance()?->db()->permits($collection, 'update', $id, $viewer, $data) ?? false)) {
            return; // the write refuses them as it refuses anyone the rule doesn't cover
        }
        self::lock($id, $takeover);
        if ($expected === null) {
            return;
        }
        if (!is_string($expected) || $expected === '') {
            throw HttpError::invalidInput('_rev must be the token a read returned', '/' . self::FIELD);
        }
        $current = self::encode($state, $staged);
        if (hash_equals($current, $expected)) {
            return;
        }
        throw new StaleRevision($current, self::changed($collection, $id, self::decode($expected), $state, $staged, $viewer));
    }

    /**
     * Run $write (an update or delete of item $id) under the item's row lock, after {@see require()}.
     * The write's own transaction joins this one, so nothing changes between the check and it.
     */
    public static function guarded(string $collection, int|string $id, mixed $expected, bool $takeover, ?Viewer $viewer, callable $write, ?array $data = null): mixed
    {
        $plugin = Plugin::instance() ?? throw new \LogicException('No First app');
        $spec = $plugin->schema->hasCollection($collection) ? $plugin->schema->collection($collection) : null;
        $store = $plugin->db()->store();
        if ($spec === null || !Staged::enabled($spec) || !$store instanceof CompositeStore || !preg_match('/^\d{1,18}$/D', (string) $id)) {
            return $write();
        }

        return $plugin->db()->transaction(static function () use ($store, $collection, $id, $expected, $takeover, $viewer, $write, $data): mixed {
            $store->posts->stagedLock((int) $id);
            self::require($collection, (int) $id, $expected, $takeover, $viewer, data: $data);

            return $write();
        });
    }

    /**
     * Core's edit lock: refused while another user holds it, unless $takeover, which takes it for the
     * caller as the editor's "Take over" does. The trusted CLI and cron never hold or meet a lock.
     */
    public static function lock(int $id, bool $takeover): void
    {
        if (get_current_user_id() === 0) {
            return;
        }
        if (!function_exists('wp_check_post_lock')) {
            require_once ABSPATH . 'wp-admin/includes/post.php';
        }
        $holder = wp_check_post_lock($id);
        if ($holder === false) {
            return;
        }
        if ($takeover) {
            Plugin::instance()?->connection()->touchPost($id);
            wp_set_post_lock($id);

            return;
        }
        $user = get_userdata((int) $holder);
        throw new Locked((int) $holder, $user instanceof \WP_User ? (string) $user->display_name : '');
    }

    /**
     * `rest_pre_dispatch`: a core REST write to an item of a First kind that another user has locked
     * (its update, delete, or a revision restore) is a 409, for a caller who may edit the item.
     * Core's own block-editor autosave already stores a per-user autosave while a post is locked.
     */
    public static function restLock(mixed $result, mixed $server, mixed $request): mixed
    {
        if ($result !== null || !$request instanceof \WP_REST_Request || in_array($request->get_method(), ['GET', 'HEAD', 'OPTIONS'], true)
            || Facade::dispatching() || get_current_user_id() === 0) {
            return $result;
        }
        foreach (Plugin::instance()?->schema->collections() ?? [] as $spec) {
            if (!Staged::enabled($spec)) {
                continue;
            }
            $type = (string) $spec['wp']['postType'];
            $base = preg_quote((string) (get_post_type_object($type)?->rest_base ?: $type), '#');
            if (!preg_match('#^/wp/v2/' . $base . '/(\d+)(/revisions/\d+/restore)?/?$#i', $request->get_route(), $m)) {
                continue;
            }
            $id = (int) $m[1];
            if (get_post_type($id) !== $type || !current_user_can('edit_post', $id)) {
                return $result; // core's own answer (404, 403) for a caller who may not edit it
            }
            try {
                self::lock($id, (bool) $request->get_param(self::TAKEOVER));
            } catch (Locked $e) {
                return new \WP_Error('first_locked', $e->getMessage(), ['status' => 409] + $e->details());
            }
        }

        return $result;
    }

    // ================================================================ internals

    /** @return ?array{id: int, modified: string, live: string, staged: ?string} */
    private static function state(string $collection, int $id): ?array
    {
        $plugin = Plugin::instance();
        $spec = $plugin !== null && $plugin->schema->hasCollection($collection) ? $plugin->schema->collection($collection) : null;
        if ($spec === null || !Staged::enabled($spec)) {
            return null;
        }
        $db = $plugin->connection();
        $wpdb = $db->wpdb();
        $post = $db->run("SELECT ID, post_modified_gmt, post_status, post_name, post_title, post_content, post_date_gmt, post_password, post_author FROM `{$wpdb->posts}` WHERE ID = ?", [$id])[0] ?? null;
        if ($post === null) {
            return null;
        }
        $prefix = $wpdb->esc_like((string) $spec['wp']['metaPrefix']);
        $meta = $db->run(
            "SELECT meta_key, meta_value FROM `{$wpdb->postmeta}` WHERE post_id = ? AND (meta_key LIKE ? OR meta_key LIKE ?) ORDER BY meta_key, meta_id",
            [$id, $prefix . '%', '\\_' . $prefix . '%'],
        );
        $staged = $db->run(
            "SELECT r.ID, r.post_modified_gmt, m.meta_value FROM `{$wpdb->posts}` r LEFT JOIN `{$wpdb->postmeta}` m ON m.post_id = r.ID AND m.meta_key = ?"
            . " WHERE r.post_parent = ? AND r.post_type = 'revision' AND r.post_name = ? ORDER BY r.ID",
            [Staged::META, $id, WpPostStore::stagedName($id)],
        );

        return [
            'id' => $id,
            'modified' => (string) $post['post_modified_gmt'],
            'live' => self::digest([$post, $meta]),
            'staged' => $staged === [] ? null : self::digest($staged),
        ];
    }

    private static function digest(mixed $value): string
    {
        return substr(hash_hmac('sha256', (string) Js::jsonStringify($value), wp_salt('nonce')), 0, 22);
    }

    /** [id, modified, live digest(, staged digest)]: the staged digest only in a staged token, and only when something is staged. */
    private static function encode(array $state, bool $staged): string
    {
        $claim = [$state['id'], $state['modified'], $state['live']];
        if ($staged && $state['staged'] !== null) {
            $claim[] = $state['staged'];
        }

        return rtrim(strtr(base64_encode((string) json_encode($claim)), '+/', '-_'), '=');
    }

    /** @return ?array{id: int, modified: string, live: string, staged: ?string} */
    private static function decode(string $token): ?array
    {
        $claim = json_decode((string) base64_decode(strtr($token, '-_', '+/'), true), true);
        if (!is_array($claim) || !in_array(count($claim), [3, 4], true) || !is_int($claim[0]) || !is_string($claim[1]) || !is_string($claim[2])
            || (isset($claim[3]) && !is_string($claim[3]))) {
            return null;
        }

        return ['id' => $claim[0], 'modified' => $claim[1], 'live' => $claim[2], 'staged' => $claim[3] ?? null];
    }

    /**
     * What changed since the token was given out: the fields that differ between the item's
     * revision at that time (First writes one on every update) and the item now, as $viewer may read
     * both; and, for a staged token, whether the staged version changed. `fields` is null when the
     * token's time has no revision to compare with (it never came from this item, or its history
     * was pruned).
     *
     * @return array{fields: ?list<string>, staged?: bool}
     */
    private static function changed(string $collection, int $id, ?array $then, array $now, bool $staged, ?Viewer $viewer): array
    {
        $out = ['fields' => null] + ($staged ? ['staged' => $then === null || $then['staged'] !== $now['staged']] : []);
        if ($then === null || $then['id'] !== $id) {
            return $out;
        }
        if ($then['live'] === $now['live']) {
            return ['fields' => []] + $out;
        }
        $plugin = Plugin::instance() ?? throw new \LogicException('No First app');
        $wpdb = $plugin->connection()->wpdb();
        $rid = $plugin->connection()->run(
            "SELECT ID FROM `{$wpdb->posts}` WHERE post_parent = ? AND post_type = 'revision' AND post_name LIKE ? AND post_date_gmt <= ? ORDER BY post_date_gmt DESC, ID DESC LIMIT 1",
            [$id, $id . '-revision-v%', $then['modified']],
        )[0]['ID'] ?? null;
        if ($rid === null) {
            return $out;
        }
        $db = $plugin->db();
        try {
            $before = $db->revisionRow($collection, $id, (int) $rid);
        } catch (HttpError) {
            return $out;
        }
        $after = $db->editorRow($collection, $id) ?? [];
        $read = static fn (array $row): array => $viewer === null ? $row : ($db->current(static fn () => \First\Extensions::read([$row], $collection, $viewer))[0] ?? []);
        [$before, $after] = [$read($before), $read($after)];
        $fields = [];
        foreach ($plugin->schema->collection($collection)['columns'] as $name => $def) {
            $name = (string) $name;
            // Generated on every update, hidden, or unreadable to this caller on either side.
            if (isset($def['onUpdate']) || ($def['hidden'] ?? false) || !array_key_exists($name, $before) || !array_key_exists($name, $after)) {
                continue;
            }
            if (!Js::sameJson($before[$name], $after[$name])) {
                $fields[] = $name;
            }
        }

        return ['fields' => $fields] + $out;
    }
}
