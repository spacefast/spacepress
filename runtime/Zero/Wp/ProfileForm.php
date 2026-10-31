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
        $js = self::timestamps($def, $js, static fn (string $iso) => get_date_from_gmt(substr($iso, 0, 10) . ' ' . substr($iso, 11, 8), 'Y-m-d\TH:i:s') . '.000Z');

        return Scf::toScf($def, Schema::store($def, $js), (string) $field['key']) ?? [];
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
        if ($open) {
            self::$open['patch'][$ctx['col']] = $js;

            return true;
        }
        self::plugin()->db()->update($ctx['collection'], [$ctx['col'] => $js], ['id' => $ctx['id']]);

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
            $patch = self::changed($collection, $id, self::$open['patch']);
            if ($patch !== []) {
                $viewer = CoreAccess::viewer() ?? throw new HttpError(403, 'suspended', 'This account is suspended');
                $rows = $plugin->db()->update($collection, $patch, ['id' => $id], true, $viewer);
                if ($rows === []) {
                    throw Access::deny($viewer->user, "update $collection rows");
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
     * save is authorized on what it changes. The baseline is the saved value through the form's own
     * round trip: an empty group or repeater posted for a member who never set one is no change.
     * A value that doesn't normalize is kept: Zero reports it.
     */
    private static function changed(string $collection, int $id, array $staged): array
    {
        $before = self::plugin()->db()->editorRow($collection, $id) ?? [];
        $columns = self::plugin()->schema->collection($collection)['columns'];
        $patch = [];
        foreach ($staged as $col => $js) {
            $col = (string) $col;
            $def = $columns[$col];
            $key = 'field_zero_member_' . $col;
            try {
                $norm = Schema::normalize($def, $js, $col, HttpError::seg($col));
                $stored = ($before[$col] ?? null) === null ? null : Schema::store($def, $before[$col]);
                $shown = Scf::toScf($def, $stored, $key) ?? (in_array($def['type'], self::STRUCTURED, true) ? [] : null);
                $baseline = Schema::normalize($def, Scf::fromScf($def, $shown, $key), $col, HttpError::seg($col));
            } catch (HttpError) {
                $patch[$col] = $js;
                continue;
            }
            if (Js::jsonStringify($norm) !== Js::jsonStringify($baseline)) {
                $patch[$col] = $js;
            }
        }

        return $patch;
    }

    /** A posted (slashed, site-time) SCF value → Zero's JS form. */
    private static function incoming(array $def, mixed $value, mixed $postId, array $field): mixed
    {
        // Scf::updateValue: json re-encoded, a top-level timestamp from site time to UTC.
        $js = Scf::fromScf($def, wp_unslash(Scf::updateValue($value, $postId, $field)), (string) $field['key']);

        return in_array($def['type'], self::STRUCTURED, true)
            ? self::timestamps($def, $js, static fn (string $iso) => get_gmt_from_date(substr($iso, 0, 10) . ' ' . substr($iso, 11, 8), 'Y-m-d\TH:i:s') . '.000Z')
            : $js;
    }

    /** Apply $fn to every timestamp inside a structured value (the pickers show site time, Zero keeps UTC). */
    private static function timestamps(array $def, mixed $v, callable $fn): mixed
    {
        if ($v === null) {
            return null;
        }
        if (($def['type'] ?? '') === 'timestamp') {
            return is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/', $v) ? $fn($v) : $v;
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
