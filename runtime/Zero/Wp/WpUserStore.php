<?php

declare(strict_types=1);

namespace Zero\Wp;

use Zero\ColumnRef;
use Zero\Dialect;
use Zero\HttpError;
use Zero\Schema;
use Zero\Source;
use Zero\Store;

/**
 * The `auth: true` collection on WordPress (§6.2): its rows ARE WordPress users, so every other
 * plugin sees members as normal users. `id` ↔ `wp_users.ID`, `email` ↔ `user_email`, `name` ↔
 * `display_name` (when the collection has a `name` column), `role` ↔ the WP role
 * (`admin` = administrator, `guest` = zero_guest), `suspendedAt` from zero-identity's account
 * status; every other column is usermeta `zero_<col>`. The password never touches this store: it
 * goes through `wp_set_password` (IdentityBridge::acceptPassword).
 */
final class WpUserStore implements Store
{
    public const META = 'zero_';
    private const ROLES = ['guest' => 'zero_guest', 'subscriber' => 'subscriber', 'author' => 'author', 'editor' => 'editor', 'admin' => 'administrator'];
    /** @var array<string, Source> */
    private array $sources = [];

    public function __construct(
        private readonly Connection $db,
        private readonly Schema $schema,
        private readonly Dialect $dialect,
        private readonly WpTableStore $tables,
    ) {
    }

    /**
     * wp-admin's profile screens edit the usermeta columns through one SCF field group located on
     * every user form (§6.2). Field names are the usermeta keys, so SCF and Zero share the values.
     */
    public static function registerFields(Schema $schema): void
    {
        $collection = $schema->auth()['collection'] ?? null;
        if ($collection === null || !function_exists('acf_add_local_field_group')) {
            return;
        }
        $spec = $schema->collection($collection);
        $fields = [];
        foreach ($spec['columns'] as $col => $def) {
            $col = (string) $col;
            // Scalar columns, whose SCF form this store reads and writes; structured columns
            // (json, group, repeater, blocks, media lists) stay API-only on user forms.
            if (in_array($col, ['id', 'email', 'name'], true) || ($def['system'] ?? false) || isset($def['references'])
                || !in_array($def['type'], ['text', 'integer', 'real', 'boolean', 'select', 'email', 'url', 'date', 'timestamp', 'richText'], true)) {
                continue;
            }
            // showIf is UI-only (§4.3) and its conditional logic resolves against post forms and saved
            // posts; on a profile screen every member field stays visible.
            $fields[] = ['conditional_logic' => 0] + array_diff_key(
                Scf::fieldFor($schema, 'field_zero_member_' . $col, self::META . $col, $col, array_diff_key($def, ['showIf' => true]), $spec),
                ['conditional_logic' => true, 'zero_logic' => true],
            );
        }
        acf_add_local_field_group([
            'key' => 'group_zero_' . $collection,
            'title' => (string) ($schema->collection($collection)['label'] ?? $collection),
            'fields' => $fields,
            'location' => [[['param' => 'user_form', 'operator' => '==', 'value' => 'all']]],
            'active' => true,
        ]);
    }

    /**
     * WordPress users created outside Zero (hosted sign-up, wp-admin, other plugins) get the member
     * columns' declared defaults, as a Zero create would give them (§6.2: rows are users).
     */
    public static function fillDefaults(Schema $schema, int $userId): void
    {
        $collection = $schema->auth()['collection'] ?? null;
        if ($collection === null) {
            return;
        }
        foreach ($schema->collection($collection)['columns'] as $col => $def) {
            $col = (string) $col;
            if (($def['system'] ?? false) || !isset($def['default']) || in_array($col, ['id', 'email', 'name'], true)
                || metadata_exists('user', $userId, self::META . $col)) {
                continue;
            }
            $stored = Schema::store($def, Schema::generate($def['default'], $def['type']));
            if ($stored === null) {
                continue;
            }
            $value = self::metaForm($def, $stored);
            update_user_meta($userId, self::META . $col, wp_slash($value));
        }
    }

    /** Storage form (§3.4) → the usermeta value SCF's own field would keep. */
    private static function metaForm(array $def, int|float|string $stored): mixed
    {
        return match ($def['type'] ?? '') {
            'select' => json_decode((string) $stored, true),   // an array; WordPress serializes it
            'boolean' => $stored ? '1' : '0',
            'timestamp' => substr((string) $stored, 0, 10) . ' ' . substr((string) $stored, 11, 8),
            'date' => str_replace('-', '', (string) $stored),
            default => is_float($stored) ? \Zero\Js::numStr($stored) : (string) $stored,
        };
    }

    public static function wpRole(string $role): string
    {
        return self::ROLES[$role] ?? 'subscriber';
    }

    public function source(string $collection): Source
    {
        return $this->sources[$collection] ??= $this->build($collection);
    }

    private function build(string $collection): Source
    {
        $spec = $this->schema->collection($collection);
        $wpdb = $this->db->wpdb();
        $meta = static fn (string $key) => "LEFT JOIN `{$wpdb->usermeta}` {j} ON {j}.user_id = {a}.ID AND {j}.meta_key = '" . addslashes($key) . "'";
        $v = "NULLIF({j}.meta_value, '')";
        $capabilities = $wpdb->get_blog_prefix() . 'capabilities';
        // The highest role on the ladder the user holds; serialized caps look like a:1:{s:6:"editor";b:1;}.
        $role = "CASE WHEN {j}.meta_value LIKE '%\"administrator\"%' THEN 'admin' WHEN {j}.meta_value LIKE '%\"editor\"%' THEN 'editor'"
            . " WHEN {j}.meta_value LIKE '%\"author\"%' THEN 'author' WHEN {j}.meta_value LIKE '%\"zero_guest\"%' THEN 'guest' ELSE 'subscriber' END";
        $status = $wpdb->prefix . 'zero_identity_accounts';
        $refs = [];
        foreach ($spec['columns'] as $col => $def) {
            $col = (string) $col;
            $refs[$col] = match (true) {
                $col === $spec['primaryKey'] => new ColumnRef('{a}.ID', '', '', 'scalar'),
                $col === 'email' => new ColumnRef('{a}.user_email', '', '', 'scalar'),
                $col === 'name' => new ColumnRef('{a}.display_name', '', '', 'scalar'),
                $col === 'role' => new ColumnRef($role, $meta($capabilities), '', 'scalar'),
                $col === 'guest' => new ColumnRef("CASE WHEN {j}.meta_value LIKE '%\"zero_guest\"%' THEN 1 ELSE 0 END", $meta($capabilities), '', 'scalar'),
                $col === 'passwordHash' => new ColumnRef('NULL', '', '', 'scalar'),
                $col === 'suspendedAt' => $this->identityTable($status)
                    ? new ColumnRef("CASE WHEN {j}.status IN ('suspended','deletion_requested','deleted') THEN '1970-01-01T00:00:00.000Z' END", "LEFT JOIN `$status` {j} ON {j}.wp_user_id = {a}.ID", '', 'scalar')
                    : new ColumnRef('NULL', '', '', 'scalar'),
                $def['type'] === 'integer', $def['type'] === 'media' => new ColumnRef($v, $meta(self::META . $col), "CAST($v AS SIGNED)", 'scalar'),
                $def['type'] === 'real' => new ColumnRef($v, $meta(self::META . $col), "CAST($v AS DECIMAL(30,10))", 'scalar'),
                // SCF's own forms where its user-form fields edit the value (as on posts, §3.5.1):
                // multiple selects are PHP-serialized arrays, booleans '1'/'0', numbers numeric text.
                $def['type'] === 'select' => new ColumnRef($v, $meta(self::META . $col), '{j}.meta_value', 'serialized-list'),
                $def['type'] === 'integer', $def['type'] === 'media' => new ColumnRef($v, $meta(self::META . $col), "CAST($v AS SIGNED)", 'scalar'),
                $def['type'] === 'real' => new ColumnRef($v, $meta(self::META . $col), "CAST($v AS DECIMAL(30,10))", 'scalar'),
                $def['type'] === 'boolean' => new ColumnRef($v, $meta(self::META . $col), $v, 'scalar'),
                // SCF's date/time pickers keep 'Y-m-d H:i:s' (UTC) and 'Ymd', as on posts (§3.5.1).
                $def['type'] === 'timestamp' => new ColumnRef("CONCAT(REPLACE($v, ' ', 'T'), '.000Z')", $meta(self::META . $col), $v, 'scalar'),
                $def['type'] === 'date' => new ColumnRef("DATE_FORMAT(STR_TO_DATE($v, '%Y%m%d'), '%Y-%m-%d')", $meta(self::META . $col), $v, 'scalar'),
                // Structured columns keep their storage form (§3.4), as custom tables do; no SCF field edits them.
                default => new ColumnRef($v, $meta(self::META . $col), ColumnRef::kindFor($def['type']) === 'scalar' ? $v : '', ColumnRef::kindFor($def['type'])),
            };
        }

        return new Source('`' . $wpdb->users . '`', '', $refs);
    }

    private function identityTable(string $table): bool
    {
        return $this->db->run('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$table]) !== [];
    }

    public function select(string $collection, array $q): array
    {
        $rows = $this->db->run($q['sql'], $q['params']);
        $spec = $this->schema->collection($collection);
        \Zero\Extensions::lookup($collection, array_column($rows, $spec['primaryKey']));
        if (isset($spec['columns']['role'])) {
            // The role a member has is the one Zero authenticates them with (capabilities, WpAuth::map).
            foreach ($rows as &$row) {
                $user = get_userdata((int) $row[$spec['primaryKey']]);
                if ($user instanceof \WP_User) {
                    $row['role'] = WpAuth::map($user)['role'];
                }
            }
            unset($row);
        }
        foreach ($spec['columns'] as $col => $def) {
            if ($def['type'] !== 'select') {
                continue;
            }
            foreach ($rows as &$row) {
                $v = $row[$col] ?? null;
                if ($v !== null) {
                    $list = is_serialized($v) ? @unserialize($v, ['allowed_classes' => false]) : json_decode((string) $v, true);
                    $row[$col] = \Zero\Js::jsonStringify(array_values(array_map('strval', is_array($list) ? $list : [$v])));
                }
            }
            unset($row);
        }

        return $rows;
    }

    public function insert(string $collection, array $values): int|string
    {
        $spec = $this->schema->collection($collection);
        $email = (string) ($values['email'] ?? '');
        if (($values['role'] ?? null) !== 'guest') {
            $this->checkEmail($email, 0);
        }
        $this->checkUnique($spec, $values, 0);
        $guest = ($values['role'] ?? null) === 'guest';
        $user = [
            'user_login' => ($guest ? 'zg_' : 'zm_') . bin2hex(random_bytes(10)),
            // Guests have no email yet: the generated placeholder is only the row's unique key.
            'user_email' => $guest ? '' : $email,
            'user_pass' => wp_generate_password(32, true, true),
            'display_name' => (string) ($values['name'] ?? $email),
            'role' => self::wpRole((string) ($values['role'] ?? 'subscriber')),
        ];
        $id = $this->db->core(static fn () => wp_insert_user(wp_slash($user)));
        if ($id instanceof \WP_Error) {
            throw new \RuntimeException('wp_insert_user failed: ' . $id->get_error_message());
        }
        $this->forgetOnRollback((int) $id);
        $this->writePassword((int) $id, $values);
        $this->writeMeta($spec, (int) $id, $values);

        return (int) $id;
    }

    public function update(string $collection, int|string $pk, array $values): void
    {
        $spec = $this->schema->collection($collection);
        $id = (int) $pk;
        $this->forgetOnRollback($id);
        $this->checkUnique($spec, $values, $id);
        $core = [];
        if (array_key_exists('email', $values)) {
            $this->checkEmail((string) $values['email'], $id);
            $core['user_email'] = (string) $values['email'];
        }
        if (array_key_exists('name', $values)) {
            $core['display_name'] = (string) ($values['name'] ?? '');
        }
        if ($core !== []) {
            $r = $this->db->core(static fn () => wp_update_user(wp_slash(['ID' => $id] + $core)));
            if ($r instanceof \WP_Error) {
                throw new \RuntimeException('wp_update_user failed: ' . $r->get_error_message());
            }
        }
        if (array_key_exists('role', $values)) {
            $this->db->core(static fn () => (new \WP_User($id))->set_role(self::wpRole((string) $values['role'])));
        }
        $this->writePassword($id, $values);
        $this->writeMeta($spec, $id, $values);
        clean_user_cache($id);
    }

    public function delete(string $collection, int|string $pk): void
    {
        require_once ABSPATH . 'wp-admin/includes/user.php';
        $id = (int) $pk;
        $this->forgetOnRollback($id);
        $this->db->core(static fn () => wp_delete_user($id));
    }

    /**
     * A write-only password (IdentityBridge::acceptPassword) goes through wp_set_password, so
     * WordPress hashes it and its `wp_set_password` hook runs for every plugin; on rollback the
     * user's cache is cleared with the rest.
     */
    private function writePassword(int $id, array $values): void
    {
        $password = PendingPassword::take($values['passwordHash'] ?? null);
        if ($password === null) {
            return;
        }
        $this->db->core(static fn () => wp_set_password($password, $id));
        clean_user_cache($id);
    }

    /** Columns stored as `zero_<col>` usermeta. */
    private function writeMeta(array $spec, int $id, array $values): void
    {
        foreach ($values as $col => $stored) {
            $col = (string) $col;
            if (in_array($col, [$spec['primaryKey'], 'email', 'name', 'role', 'guest', 'passwordHash', 'suspendedAt'], true)) {
                continue;
            }
            $value = $stored === null ? null : self::metaForm($spec['columns'][$col] ?? [], $stored);
            $this->db->core(static fn () => $value === null
                ? delete_user_meta($id, self::META . $col)
                : update_user_meta($id, self::META . $col, wp_slash($value)));
        }
    }

    /** On rollback, WordPress's caches of this user (row and usermeta) must not outlive the SQL. */
    private function forgetOnRollback(int $id): void
    {
        $this->db->onRollback(static function () use ($id): void {
            clean_user_cache($id);
            wp_cache_delete($id, 'user_meta');
        });
    }

    /** Declared unique usermeta columns hold no duplicate (email is wp_users' own, checked apart). */
    private function checkUnique(array $spec, array $values, int $self): void
    {
        foreach ($values as $col => $stored) {
            $col = (string) $col;
            if ($stored === null || $col === 'email' || !($spec['columns'][$col]['unique'] ?? false) || in_array($col, [$spec['primaryKey'], 'role'], true)) {
                continue;
            }
            $hit = $col === 'name'
                ? $this->db->run('SELECT ID FROM `' . $this->db->wpdb()->users . '` WHERE display_name = ? AND ID <> ? LIMIT 1 FOR UPDATE', [(string) $stored, $self])
                : $this->db->run(
                    'SELECT user_id FROM `' . $this->db->wpdb()->usermeta . '` WHERE meta_key = ? AND meta_value = ? AND user_id <> ? LIMIT 1 FOR UPDATE',
                    [self::META . $col, maybe_serialize(self::metaForm($spec['columns'][$col], $stored)), $self],
                );
            if ($hit !== []) {
                throw new HttpError(409, 'unique_violation', "A row with this $col already exists", HttpError::seg($col));
            }
        }
    }

    private function checkEmail(string $email, int $self): void
    {
        $hit = $this->db->run('SELECT ID FROM `' . $this->db->wpdb()->users . '` WHERE user_email = ? AND ID <> ? LIMIT 1 FOR UPDATE', [$email, $self]);
        if ($hit !== []) {
            throw new HttpError(409, 'unique_violation', 'A row with this email already exists', '/email');
        }
    }

    // ================================================================ the rest is shared with the custom-table store

    public function transaction(callable $fn): mixed
    {
        return $this->db->transaction($fn);
    }

    public function afterCommit(callable $fn): void
    {
        $this->db->afterCommit($fn);
    }

    public function applySystemStatements(array $statements): void
    {
        $this->tables->applySystemStatements($statements);
    }

    public function dialect(): Dialect
    {
        return $this->dialect;
    }

    public function globalRead(string $name): ?array
    {
        return $this->tables->globalRead($name);
    }

    public function globalWrite(string $name, array $values): void
    {
        $this->tables->globalWrite($name, $values);
    }

    public function revisions(string $collection, int|string $pk): array
    {
        return [];
    }

    public function revisionWrite(string $collection, int|string $pk, array $encodedRow, ?int $userId): void
    {
    }

    public function revision(string $collection, int|string $pk, int $revisionId): ?array
    {
        return null;
    }

    public function promoteDue(string $collection, string $nowIso): array
    {
        return [];
    }

    public function mapError(\Throwable $e): \Throwable
    {
        return $this->tables->mapError($e);
    }
}
