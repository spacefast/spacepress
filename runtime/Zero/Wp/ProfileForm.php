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
 * - render: `acf/pre_load_value` serves structured values from the member row (timestamps in site
 *   time, as SCF's pickers show them). Member fields render only for a viewer whose read rule covers
 *   the member and who may read everything the field holds; structured fields appear only on an
 *   existing user's edit screen (never the add or register forms).
 * - save: a wp-admin profile save (`profile.php`, `user-edit.php`) is one transaction opened before
 *   core updates the user. Each member field the form posts is staged instead of written; the values
 *   that changed are written in one `Db::update` with the signed-in viewer, so the collection's update
 *   rule, field write rules, validation and hooks decide, as on `/zero/v1`. A refusal rolls the whole
 *   save back (core's user changes included) and answers with Zero's status and message; a save core
 *   itself rejects (mismatched passwords) is rolled back before the form is shown again. A posted
 *   structured value is read back the way the form wrote it (fromForm): sub-fields SCF left out (a
 *   showIf hid them) keep their saved values, an unchanged time control keeps its saved instant.
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
        // Requiredness is checked by Zero after omitted controls have been reconciled with storage.
        Scf::fieldFilter(static function (array $field): array {
            if (str_starts_with($field['key'], 'field_zero_member_')) {
                $field['required'] = 0;
            }

            return $field;
        });
        add_action('personal_options_update', [self::class, 'begin'], 0);
        add_action('edit_user_profile_update', [self::class, 'begin'], 0);
        // Core rejected the user (edit_user returns before profile_update): nothing of the save stays open.
        add_action('user_profile_update_errors', [self::class, 'rejected'], PHP_INT_MAX, 1);
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
        $js = self::toForm($def, $js);

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
        return self::readable($collection, $id, $stored, (string) $def['name'], $def, $viewer) ? $field : false;
    }

    /**
     * May the viewer read field $col of member $id as stored: the collection's read rule covers the
     * member, the field's read rule admits it, and (structured) nothing inside it may be hidden, since
     * the form renders an input for every sub-field.
     */
    private static function readable(string $collection, int $id, ?array $stored, string $col, array $def, \Zero\Viewer $viewer): bool
    {
        if ($stored === null || !self::plugin()->db()->permits($collection, 'read', $id, $viewer)) {
            return false;
        }
        $visible = FieldAccess::strip([$stored], $collection, $viewer)[0] ?? [];
        $nested = in_array($def['type'], self::STRUCTURED, true) && FieldAccess::mayHide(['access' => []] + $def, $viewer);

        return !$nested && array_key_exists($col, $visible) && $visible[$col] === ($stored[$col] ?? null);
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
        $js = $ctx['structured']
            ? self::incoming($ctx, wp_unslash($value), $field, $open)
            : Scf::fromScf($ctx['def'], wp_unslash(Scf::updateValue($value, $postId, $field)), (string) $field['key']);
        if ($open) {
            self::$open['patch'][$ctx['col']] = $js;

            return true;
        }
        self::plugin()->db()->update($ctx['collection'], [$ctx['col'] => $js], ['id' => $ctx['id']]);
        acf_flush_value_cache($postId, (string) $field['name']);

        return true;
    }

    /** SCF validates the same effective value that the profile save will write, before its AJAX gate. */
    public static function validationValue(mixed $raw, array $field): mixed
    {
        $postId = acf_get_form_data('post_id') ?: ($_POST['_acf_post_id'] ?? null);
        $ctx = self::member($postId, $field);

        return $ctx !== null && $ctx['structured']
            ? self::incoming($ctx, $raw, $field, true, true)
            : Scf::fromScf($field['zero'], $raw, (string) $field['key'], true);
    }

    private static function incoming(array $ctx, mixed $raw, array $field, bool $form, bool $strict = false): mixed
    {
        $row = self::plugin()->db()->editorRow($ctx['collection'], $ctx['id']);
        $viewer = $form ? CoreAccess::viewer() : null;
        $rendered = $viewer !== null && self::readable($ctx['collection'], $ctx['id'], $row, $ctx['col'], $ctx['def'], $viewer);
        // Never use a hidden field's stored value to interpret a guess submitted for it.
        return self::fromForm($ctx['def'], Scf::fromScf($ctx['def'], $raw, (string) $field['key'], $strict),
            $rendered || !$form ? ($row[$ctx['col']] ?? null) : null, $rendered ? $viewer : null, $raw, (string) $field['key']);
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

    /** user_profile_update_errors: core refused the user, so the form shows again; end the save first. */
    public static function rejected(mixed $errors): void
    {
        if (self::$open !== null && $errors instanceof \WP_Error && $errors->has_errors()) {
            self::rollback();
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
     * save is authorized on what it changes. A field the viewer can't read was never rendered:
     * anything posted for it goes to Zero uncompared, so it is refused or allowed on the rules alone
     * (comparing would tell a guess that matches the hidden value from one that doesn't). Both sides
     * are compared as the form represents them (canonical). A value that doesn't normalize is kept:
     * Zero reports it.
     */
    private static function changed(string $collection, int $id, array $staged, \Zero\Viewer $viewer): array
    {
        $before = self::plugin()->db()->editorRow($collection, $id);
        $columns = self::plugin()->schema->collection($collection)['columns'];
        $patch = [];
        foreach ($staged as $col => $js) {
            $col = (string) $col;
            $def = $columns[$col];
            if (!self::readable($collection, $id, $before, $col, $def, $viewer)) {
                $patch[$col] = $js;
                continue;
            }
            try {
                $posted = self::canonical($def, Schema::normalize($def, $js, $col, HttpError::seg($col)));
            } catch (HttpError) {
                $patch[$col] = $js;
                continue;
            }
            if (Js::jsonStringify($posted) !== Js::jsonStringify(self::canonical($def, $before[$col] ?? null))) {
                $patch[$col] = $js;
            }
        }

        return $patch;
    }

    /**
     * A decoded value as the form represents it, at every depth: an empty list and no list read the
     * same, as do no group and a group whose sub-fields all hold what an unset group renders (empty,
     * or their default).
     */
    private static function canonical(array $def, mixed $v): mixed
    {
        $item = static function (array $fields, array $obj): array {
            foreach ($fields as $name => $sub) {
                if (array_key_exists($name, $obj)) {
                    $obj[$name] = self::canonical($sub, $obj[$name]);
                }
            }

            return $obj;
        };

        return match (true) {
            $def['type'] === 'boolean' && $v === null => false,
            !is_array($v) => $v,
            $def['type'] === 'group' => self::isUnsetGroup($def['fields'] ?? [], $item($def['fields'] ?? [], $v)) ? null : $item($def['fields'] ?? [], $v),
            $def['type'] === 'repeater' => $v === [] ? null : array_map(static fn ($row) => is_array($row) ? $item($def['fields'] ?? [], $row) : $row, $v),
            $def['type'] === 'blocks' => $v === [] ? null : array_map(static fn ($row) => is_array($row) ? $item($def['layouts'][$row['layout'] ?? ''] ?? [], $row) : $row, $v),
            default => $v,
        };
    }

    /** Does a (canonical) group hold only what an unset group renders? */
    private static function isUnsetGroup(array $fields, array $obj): bool
    {
        foreach ($fields as $name => $sub) {
            $value = $obj[$name] ?? null;
            if ($value !== null && !self::isDefault($sub, $value)) {
                return false;
            }
        }

        return true;
    }

    /**
     * A posted structured value (SCF's form decoded, timestamps in site time) → what Zero should be
     * given, against $stored, the saved value at the same place (null: a new item).
     *
     * - timestamps: an unchanged control keeps the saved instant (milliseconds, and the hour a DST
     *   change makes ambiguous); a changed one is converted from site time. Only an exact calendar
     *   time is converted; anything else reaches Zero's validation as posted.
     * - lists: an emptied list posts '' (null): the empty list, unless the saved value is null too.
     * - $viewer (the field was rendered for this viewer): a sub-field SCF left out of an existing item
     *   (a showIf hid and disabled it) keeps its saved value; in a new item, a sub-field the viewer may
     *   not set, posted at its default, is left to the default as the API would.
     */
    private static function fromForm(array $def, mixed $posted, mixed $stored, ?\Zero\Viewer $viewer, mixed $raw, string $key): mixed
    {
        $item = static function (array $fields, mixed $obj, mixed $before, mixed $input, string $prefix) use ($viewer): mixed {
            if (!is_array($obj)) {
                return $obj;
            }
            $before = is_array($before) ? $before : null;
            foreach ($fields as $name => $sub) {
                if (!array_key_exists($name, $obj)) {
                    if ($viewer !== null && $before !== null && array_key_exists($name, $before)) {
                        $obj[$name] = $before[$name];
                    }
                    continue;
                }
                if ($viewer !== null && $before === null
                    && FieldAccess::unwritable('update', $sub, $viewer) && self::isDefault($sub, $obj[$name])) {
                    unset($obj[$name]);
                    continue;
                }
                $obj[$name] = self::fromForm($sub, $obj[$name], $before[$name] ?? null, $viewer,
                    is_array($input) ? ($input[$prefix . $name] ?? $input[$name] ?? null) : null, $prefix . $name);
                if ($viewer !== null && $before !== null && array_key_exists($name, $before) && $before[$name] === null
                    && (($sub['type'] === 'boolean' && $obj[$name] === false)
                        || (in_array($sub['type'], self::STRUCTURED, true) && !($sub['notNull'] ?? false) && self::canonical($sub, $obj[$name]) === null))) {
                    $obj[$name] = null;
                }
            }

            return $obj;
        };
        $old = is_array($stored) && array_is_list($stored) ? $stored : [];
        $inputs = is_array($raw) ? array_filter($raw, static fn ($k) => $k !== 'acfcloneindex', ARRAY_FILTER_USE_KEY) : [];
        $keys = array_keys($inputs);
        $inputs = array_values($inputs);
        $row = static function (mixed $value, int $i) use ($def, $old, $viewer, $keys, $inputs, $key, $item): mixed {
            // The rendered row key names its saved index even after a deletion or a drag. New rows
            // have generated keys; SCF prefixes the key again on a rejected form. Trusted code uses
            // ordinary list positions.
            $index = $viewer === null ? $i : (preg_match('/^(?:row-)+(\d+)$/D', (string) ($keys[$i] ?? ''), $m) ? (int) $m[1] : null);
            $before = $index === null ? null : ($old[$index] ?? null);
            if ($def['type'] === 'blocks') {
                $layout = is_array($value) ? ($value['layout'] ?? '') : '';

                return $item($def['layouts'][$layout] ?? [], $value,
                    ($before['layout'] ?? null) === $layout ? $before : null, $inputs[$i] ?? null, $key . '_' . $layout . '_');
            }

            return $item($def['fields'] ?? [], $value, $before, $inputs[$i] ?? null, $key . '_');
        };

        if ($def['type'] === 'group') {
            $value = $item($def['fields'] ?? [], $posted, $stored, $raw, $key . '_');

            return $viewer !== null && $stored === null && !($def['notNull'] ?? false) && self::canonical($def, $value) === null ? null : $value;
        }

        return match ($def['type'] ?? '') {
            'timestamp' => self::wallToUtc($posted, $stored),
            'repeater', 'blocks' => match (true) {
                $posted === null => $stored === null && !($def['notNull'] ?? false) ? null : [],
                !is_array($posted) => $posted,
                default => array_map($row, $posted, array_keys($posted)),
            },
            default => $posted,
        };
    }

    /** A posted site-time timestamp → UTC; the saved instant when the control still shows it. */
    private static function wallToUtc(mixed $posted, mixed $stored): mixed
    {
        $wall = self::wall($posted, '/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})\.000Z$/D');
        if ($wall === null) {
            return $posted;
        }
        if (is_string($stored) && self::utcToWall($stored) === str_replace(' ', 'T', $wall) . '.000Z') {
            return $stored;
        }

        return str_replace(' ', 'T', get_gmt_from_date($wall, 'Y-m-d H:i:s')) . '.000Z';
    }

    /** A saved UTC timestamp (any precision) → site time, as the picker shows it (to the second). */
    private static function utcToWall(mixed $stored): mixed
    {
        $wall = self::wall($stored, '/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d{1,3})?Z$/D');

        return $wall === null ? $stored : str_replace(' ', 'T', get_date_from_gmt($wall, 'Y-m-d H:i:s')) . '.000Z';
    }

    /** 'Y-m-d H:i:s' of an ISO string matching $pattern that names a real calendar time, else null. */
    private static function wall(mixed $v, string $pattern): ?string
    {
        if (!is_string($v) || !preg_match($pattern, $v, $m)) {
            return null;
        }
        $at = \DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', "$m[1] $m[2]", new \DateTimeZone('UTC'));

        return $at !== false && $at->format('Y-m-d H:i:s') === "$m[1] $m[2]" ? "$m[1] $m[2]" : null;
    }

    /** A saved structured value with its timestamps in site time, for the form. */
    private static function toForm(array $def, mixed $v): mixed
    {
        $item = static function (array $fields, mixed $obj): mixed {
            if (!is_array($obj)) {
                return $obj;
            }
            foreach ($fields as $name => $sub) {
                if (array_key_exists($name, $obj)) {
                    $obj[$name] = self::toForm($sub, $obj[$name]);
                }
            }

            return $obj;
        };

        return match ($def['type'] ?? '') {
            'timestamp' => self::utcToWall($v),
            'group' => $item($def['fields'] ?? [], $v),
            'repeater' => is_array($v) ? array_map(static fn ($row) => $item($def['fields'] ?? [], $row), $v) : $v,
            'blocks' => is_array($v) ? array_map(static fn ($row) => is_array($row) ? $item($def['layouts'][$row['layout'] ?? ''] ?? [], $row) : $row, $v) : $v,
            default => $v,
        };
    }

    /** Is $v (as posted) the value a new item starts with: the sub-field's constant default, or null without one? */
    private static function isDefault(array $def, mixed $v): bool
    {
        if (isset($def['default']) && !array_key_exists('value', $def['default'])) {
            return false; // a generated default: whatever was posted wasn't it
        }
        $default = $def['default']['value'] ?? null;
        try {
            $norm = Schema::normalize(['notNull' => false] + $def, $v, (string) ($def['name'] ?? ''), '');
        } catch (HttpError) {
            return false;
        }

        return Js::jsonStringify(self::canonical($def, $norm)) === Js::jsonStringify(self::canonical($def, $default));
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
