<?php

declare(strict_types=1);

namespace Zero\Wp;

use Zero\Access;
use Zero\FieldAccess;
use Zero\HttpError;
use Zero\Js;
use Zero\Schema;

/**
 * The `auth: true` collection's fields on WordPress's profile screens (§6.2), group, repeater and
 * blocks columns included. Member columns keep Zero's storage form (structured ones are one JSON
 * usermeta `zero_<col>`, as custom tables keep them), so SCF never stores them itself:
 *
 * - render: `acf/pre_load_value` serves structured values from the member row; a field the viewer
 *   can't read (or a structured one holding anything it may not read) isn't rendered, and structured
 *   fields appear only on an existing user's edit screen (never the add or register forms).
 * - save: a wp-admin profile save (`profile.php`, `user-edit.php`) is one transaction opened before
 *   core updates the user. Each member field the form posts is staged instead of written; the values
 *   that changed are written in one `Db::update` with the signed-in viewer, so the collection's update
 *   rule, field write rules, validation and hooks decide, as on `/zero/v1`. A refusal rolls the whole
 *   save back (core's user changes included) and answers with Zero's status and message.
 * - code: `update_field()` on a structured member field outside a profile save (WP-CLI, cron, other
 *   plugins) is a trusted Zero write, as `update_user_meta` is for WordPress.
 */
final class ProfileForm
{
    private const STRUCTURED = ['group', 'repeater', 'blocks'];

    /** @var ?array{user: int, patch: array<string, mixed>} the open profile save */
    private static ?array $open = null;

    public static function register(): void
    {
        add_action('personal_options_update', [self::class, 'begin'], 0);
        add_action('edit_user_profile_update', [self::class, 'begin'], 0);
        // After SCF's own save_user (10), which stages every posted field through pre_update_value.
        add_action('profile_update', [self::class, 'end'], 1000, 1);
        add_filter('acf/pre_load_value', [self::class, 'load'], 20, 3);
        add_filter('acf/pre_update_value', [self::class, 'update'], 5, 4);
        add_filter('acf/prepare_field', [self::class, 'prepare'], 20);
        // Values never pass through SCF's own write, so its field reference (`_zero_<col>`) isn't kept:
        // answer it from the field group, so get_field() by name resolves on every member.
        add_filter('acf/pre_load_reference', [self::class, 'reference'], 10, 3);
        register_shutdown_function([self::class, 'shutdown']);
    }

    // ================================================================ render

    /** acf/pre_load_value: a structured member field reads the member row's value, in SCF's form. */
    public static function load(mixed $value, mixed $postId, mixed $field): mixed
    {
        if ($value !== null || ($ctx = self::member($postId, $field)) === null || !$ctx['structured']) {
            return $value;
        }
        [$collection, $id, $def, $col] = [$ctx['collection'], $ctx['id'], $ctx['def'], $ctx['col']];
        $row = self::plugin()->db()->editorRow($collection, $id);
        $js = $row[$col] ?? null;
        if ($js === null) {
            return [];
        }
        $js = self::timestamps($def, $js, static fn (string $wall) => get_date_from_gmt($wall, 'Y-m-d H:i:s'));

        return Scf::toScf($def, Schema::store($def, $js), (string) $field['key']) ?? [];
    }

    /** acf/pre_load_reference: a member field name's field key, for every user. */
    public static function reference(mixed $reference, mixed $name, mixed $postId): mixed
    {
        if ($reference !== null || !is_string($name) || !str_starts_with($name, WpUserStore::META)
            || !is_string($postId) || !preg_match('/^user_\d+$/D', $postId)) {
            return $reference;
        }
        $collection = Plugin::instance()?->schema->auth()['collection'] ?? null;
        $col = substr($name, strlen(WpUserStore::META));
        $def = $collection === null ? null : (Plugin::instance()->schema->collection($collection)['columns'][$col] ?? null);

        return is_array($def) && WpUserStore::onProfile($col, $def) ? 'field_zero_member_' . $col : $reference;
    }

    /** acf/prepare_field: member fields render only for a viewer who may read everything they hold. */
    public static function prepare(mixed $field): mixed
    {
        if (!is_array($field) || empty($field['zero_member']) || !function_exists('acf_get_form_data')) {
            return $field;
        }
        $formId = acf_get_form_data('post_id');
        $id = is_string($formId) && preg_match('/^user_(\d+)$/D', $formId, $m) ? (int) $m[1] : 0;
        $def = $field['zero'] ?? [];
        $structured = in_array($def['type'] ?? '', self::STRUCTURED, true);
        $plugin = Plugin::instance();
        $collection = $plugin?->schema->auth()['collection'] ?? null;
        if ($plugin === null || $collection === null) {
            return $field;
        }
        $stored = $id > 0 ? $plugin->db()->editorRow($collection, $id) : null;
        if ($stored === null) {
            // The add and register forms create users outside a profile save: structured values have
            // no checked path there, so those fields are edited once the user exists.
            return $structured ? false : $field;
        }
        $viewer = CoreAccess::viewer();
        if ($viewer === null) {
            return false;
        }
        $col = (string) $def['name'];
        $visible = FieldAccess::strip([$stored], $collection, $viewer)[0] ?? [];
        // A structured field renders inputs for every sub-field: one that may be hidden hides it all.
        $nested = $structured && FieldAccess::mayHide(['access' => []] + $def, $viewer);

        return !$nested && array_key_exists($col, $visible) && $visible[$col] === $stored[$col] ? $field : false;
    }

    // ================================================================ save

    /** personal_options_update / edit_user_profile_update: open the save before core updates the user. */
    public static function begin(mixed $userId): void
    {
        $plugin = Plugin::instance();
        if ($plugin === null || ($plugin->schema->auth()['collection'] ?? null) === null || $plugin->unavailable() !== null
            || $plugin->connection()->busy() || $plugin->connection()->inTransaction()) {
            return;
        }
        $plugin->connection()->begin();
        self::$open = ['user' => (int) $userId, 'patch' => []];
    }

    /**
     * acf/pre_update_value: inside a profile save, a member field is staged (written by end()); outside
     * one, a structured member field is a trusted Zero write. Either way SCF writes nothing itself.
     */
    public static function update(mixed $check, mixed $value, mixed $postId, mixed $field): mixed
    {
        if ($check !== null || Scf::$io > 0 || ($ctx = self::member($postId, $field)) === null) {
            return $check;
        }
        $open = self::$open !== null && self::$open['user'] === $ctx['id'];
        if (!$open && !$ctx['structured']) {
            return $check; // code writing a scalar member field: SCF keeps Zero's storage form already
        }
        if (!$open && doing_action('user_register')) {
            return true; // the add/register forms render no structured fields: nothing posted is kept
        }
        $js = self::incoming($ctx['def'], $value, $postId, $field);
        if ($open && $ctx['structured'] && ($viewer = CoreAccess::viewer()) !== null) {
            $stored = self::plugin()->db()->editorRow($ctx['collection'], $ctx['id'])[$ctx['col']] ?? null;
            $js = self::withoutRenderedDefaults($ctx['def'], $js, $stored, $viewer);
        }
        if ($open) {
            self::$open['patch'][$ctx['col']] = $js;

            return true;
        }
        self::plugin()->db()->update($ctx['collection'], [$ctx['col'] => $js], ['id' => $ctx['id']]);
        acf_flush_value_cache($postId, (string) $field['name']);

        return true;
    }

    /** profile_update: write the changed member fields through Zero with the viewer, then commit. */
    public static function end(mixed $userId): void
    {
        if (self::$open === null || self::$open['user'] !== (int) $userId || self::plugin()->connection()->busy()) {
            return;
        }
        $plugin = self::plugin();
        $collection = (string) $plugin->schema->auth()['collection'];
        $id = self::$open['user'];
        try {
            $viewer = CoreAccess::viewer() ?? throw new HttpError(403, 'suspended', 'This account is suspended');
            $patch = self::changed($collection, $id, self::$open['patch'], $viewer);
            if ($patch !== []) {
                // Hooks and validators see the signed-in user as ctx.user, as on /zero/v1.
                $previous = $plugin->db()->actor();
                $plugin->db()->setActor($viewer->user);
                try {
                    $rows = $plugin->db()->update($collection, $patch, ['id' => $id], true, $viewer);
                } finally {
                    $plugin->db()->setActor($previous);
                }
                if ($rows === []) {
                    throw Access::deny($viewer->user, "update $collection rows");
                }
                foreach (array_keys($patch) as $col) {
                    acf_flush_value_cache("user_$id", WpUserStore::META . $col);
                }
            }
        } catch (\Throwable $e) {
            self::rollback();
            $problem = \Zero\App::problem($e);
            wp_die(esc_html($problem['detail']), '', ['response' => $problem['status'], 'code' => $problem['code'], 'back_link' => true]);
        }
        self::$open = null;
        try {
            $plugin->connection()->commit();
        } finally {
            self::forget($id);
        }
    }

    /** A profile save still open at shutdown never completed (an error page, a failed update): roll it back. */
    public static function shutdown(): void
    {
        if (self::$open !== null) {
            self::rollback();
        }
    }

    private static function rollback(): void
    {
        $id = self::$open['user'] ?? 0;
        self::$open = null;
        try {
            self::plugin()->connection()->rollback();
        } finally {
            self::forget($id);
        }
    }

    /** Core wrote the user outside Zero's store: no cache may keep a ghost of a rolled-back save. */
    private static function forget(int $id): void
    {
        clean_user_cache($id);
        wp_cache_delete($id, 'user_meta');
        CoreAccess::flush();
    }

    /**
     * The staged values that differ from what the form showed (it posts every rendered field), so a
     * save is authorized on what it changes. A field the viewer can't fully read was never rendered:
     * anything posted for it goes to Zero uncompared, so field access refuses it whatever its value
     * (comparing would tell a guess that matches the hidden value from one that doesn't). Both sides
     * are compared as the form represents them, where an empty list may post as '' or nothing.
     * A value that doesn't normalize is kept: Zero reports it.
     */
    private static function changed(string $collection, int $id, array $staged, \Zero\Viewer $viewer): array
    {
        $before = self::plugin()->db()->editorRow($collection, $id) ?? [];
        $visible = FieldAccess::strip([$before], $collection, $viewer)[0] ?? [];
        $columns = self::plugin()->schema->collection($collection)['columns'];
        $patch = [];
        foreach ($staged as $col => $js) {
            $col = (string) $col;
            $def = $columns[$col];
            $structured = in_array($def['type'], self::STRUCTURED, true);
            $readable = array_key_exists($col, $visible) && $visible[$col] === ($before[$col] ?? null)
                && !($structured && FieldAccess::mayHide(['access' => []] + $def, $viewer));
            if (!$readable) {
                $patch[$col] = $js;
                continue;
            }
            try {
                $posted = self::shown($def, Schema::normalize($def, $js, $col, HttpError::seg($col)));
                $saved = self::shown($def, $before[$col] ?? null);
            } catch (HttpError) {
                $patch[$col] = $js;
                continue;
            }
            if (Js::jsonStringify($posted) !== Js::jsonStringify($saved)) {
                $patch[$col] = $js;
            }
        }

        return $patch;
    }

    /**
     * A decoded value as the form represents it: an empty list and no list read the same, as do no
     * group and a group whose sub-fields all hold what an unset group renders (empty, or the default).
     */
    private static function shown(array $def, mixed $v): mixed
    {
        if (in_array($def['type'], ['repeater', 'blocks'], true) && $v === []) {
            return null;
        }
        if ($def['type'] === 'group' && is_array($v)) {
            foreach ($def['fields'] ?? [] as $name => $sub) {
                $value = $v[$name] ?? null;
                if (!($value === null || self::isDefault($sub, $value)) || in_array($sub['type'] ?? '', self::STRUCTURED, true) && self::shown($sub, $value) !== null) {
                    return $v;
                }
            }

            return null;
        }

        return $v;
    }

    /**
     * The form renders a new group or row with every sub-field at its default and posts them all,
     * those the viewer may not set included (an unchecked toggle posts its "0"). Such a sub-field
     * posted at its default in an item that doesn't exist yet was never set by the viewer: it is left
     * out, so the default applies as it would through the API. Any other value for it is kept, and
     * field access refuses it. Items that already exist are compared by Zero itself (unchanged
     * values pass).
     */
    private static function withoutRenderedDefaults(array $def, mixed $posted, mixed $stored, \Zero\Viewer $viewer): mixed
    {
        $item = static function (array $fields, mixed $obj, mixed $before) use ($viewer): mixed {
            if (!is_array($obj)) {
                return $obj;
            }
            $before = is_array($before) ? $before : null;
            foreach ($fields as $name => $sub) {
                if (!array_key_exists($name, $obj)) {
                    continue;
                }
                if ($before === null && !in_array($sub['type'] ?? '', self::STRUCTURED, true)
                    && FieldAccess::unwritable('update', $sub, $viewer) && self::isDefault($sub, $obj[$name])) {
                    unset($obj[$name]);
                    continue;
                }
                if (in_array($sub['type'] ?? '', self::STRUCTURED, true)) {
                    $obj[$name] = self::withoutRenderedDefaults($sub, $obj[$name], $before[$name] ?? null, $viewer);
                }
            }

            return $obj;
        };
        $old = is_array($stored) ? array_values($stored) : [];

        return match ($def['type'] ?? '') {
            'group' => $item($def['fields'] ?? [], $posted, $stored),
            // Rows past the saved ones are new (SCF posts rows in order).
            'repeater' => is_array($posted) ? array_map(static fn ($row, $i) => $item($def['fields'] ?? [], $row, $old[$i] ?? null), $posted, array_keys($posted)) : $posted,
            'blocks' => is_array($posted) ? array_map(static fn ($row, $i) => is_array($row)
                ? $item($def['layouts'][$row['layout'] ?? ''] ?? [], $row, ($old[$i]['layout'] ?? null) === ($row['layout'] ?? null) ? ($old[$i] ?? null) : null)
                : $row, $posted, array_keys($posted)) : $posted,
            default => $posted,
        };
    }

    /** Is $v (as posted) the value a new item starts with: the sub-field's constant default, or null without one? */
    private static function isDefault(array $def, mixed $v): bool
    {
        $default = isset($def['default']) && array_key_exists('value', $def['default']) ? $def['default']['value'] : null;
        if (isset($def['default']) && !array_key_exists('value', $def['default'])) {
            return false; // a generated default: whatever was posted wasn't it
        }
        try {
            $norm = Schema::normalize(['notNull' => false] + $def, $v, (string) ($def['name'] ?? ''), '');
        } catch (HttpError) {
            return false;
        }

        return Js::jsonStringify($norm) === Js::jsonStringify($default);
    }

    /** A posted (slashed, site-time) SCF value → Zero's JS form. */
    private static function incoming(array $def, mixed $value, mixed $postId, array $field): mixed
    {
        // Scf::updateValue: json re-encoded, a top-level timestamp from site time to UTC.
        $js = Scf::fromScf($def, wp_unslash(Scf::updateValue($value, $postId, $field)), (string) $field['key']);
        if ($js === null && in_array($def['type'], ['repeater', 'blocks'], true)) {
            $js = []; // an emptied (or never filled) list posts '': it is the empty list
        }

        return in_array($def['type'], self::STRUCTURED, true)
            ? self::timestamps($def, $js, static fn (string $wall) => get_gmt_from_date($wall, 'Y-m-d H:i:s'))
            : $js;
    }

    /**
     * Apply $fn (wall time 'Y-m-d H:i:s' → wall time) to every timestamp inside a structured value: the
     * pickers show site time, Zero keeps UTC. Only an exact, real calendar time is converted; anything
     * else is left as it is, for Zero's validation to refuse.
     */
    private static function timestamps(array $def, mixed $v, callable $fn): mixed
    {
        if ($v === null) {
            return null;
        }
        if (($def['type'] ?? '') === 'timestamp') {
            if (!is_string($v) || !preg_match('/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})\.000Z$/D', $v, $m)) {
                return $v;
            }
            $at = \DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', "$m[1] $m[2]", new \DateTimeZone('UTC'));
            if ($at === false || $at->format('Y-m-d H:i:s') !== "$m[1] $m[2]") {
                return $v; // not a real calendar time (2026-02-30): Zero refuses it unconverted
            }

            return str_replace(' ', 'T', $fn("$m[1] $m[2]")) . '.000Z';
        }
        $item = static function (array $fields, mixed $obj) use ($fn): mixed {
            if (!is_array($obj)) {
                return $obj;
            }
            foreach ($fields as $name => $sub) {
                if (array_key_exists($name, $obj)) {
                    $obj[$name] = self::timestamps($sub, $obj[$name], $fn);
                }
            }

            return $obj;
        };

        return match ($def['type'] ?? '') {
            'group' => $item($def['fields'] ?? [], $v),
            'repeater' => is_array($v) ? array_map(static fn ($row) => $item($def['fields'] ?? [], $row), $v) : $v,
            'blocks' => is_array($v) ? array_map(static fn ($row) => is_array($row) ? $item($def['layouts'][$row['layout'] ?? ''] ?? [], $row) : $row, $v) : $v,
            default => $v,
        };
    }

    /** @return ?array{collection: string, id: int, col: string, def: array, structured: bool} a top-level member field on an existing user */
    private static function member(mixed $postId, mixed $field): ?array
    {
        if (!is_array($field) || empty($field['zero_member']) || !is_string($postId) || !preg_match('/^user_(\d+)$/D', $postId, $m) || (int) $m[1] === 0) {
            return null;
        }
        $collection = Plugin::instance()?->schema->auth()['collection'] ?? null;
        $def = $field['zero'] ?? null;
        if ($collection === null || !is_array($def)) {
            return null;
        }

        return ['collection' => (string) $collection, 'id' => (int) $m[1], 'col' => (string) $def['name'], 'def' => $def,
            'structured' => in_array($def['type'], self::STRUCTURED, true)];
    }

    private static function plugin(): Plugin
    {
        return Plugin::instance() ?? throw new \LogicException('No Zero app');
    }
}
