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
        $fields = [];
        foreach ($schema->collection($collection)['columns'] as $col => $def) {
            $col = (string) $col;
            if (in_array($col, ['id', 'email', 'name'], true) || ($def['system'] ?? false)) {
                continue;
            }
            $base = ['key' => 'field_zero_member_' . $col, 'label' => ucfirst($col), 'name' => self::META . $col, 'required' => 0];
            $extra = match ($def['type']) {
                'integer', 'real' => ['type' => 'number', 'step' => $def['type'] === 'integer' ? 1 : 'any'],
                'boolean' => ['type' => 'true_false', 'ui' => 1],
                'select' => ['type' => 'select', 'choices' => array_combine($def['enum'] ?? [], $def['enum'] ?? []), 'multiple' => 1, 'ui' => 1, 'return_format' => 'value'],
                'email' => ['type' => 'email'],
                'url' => ['type' => 'url'],
                'text' => isset($def['enum'])
                    ? ['type' => 'select', 'choices' => array_combine($def['enum'], $def['enum']), 'return_format' => 'value']
                    : ['type' => 'text'],
                // Structured columns (json, group, repeater, blocks, media, dates) stay API-only.
                default => null,
            };
            if ($extra === null) {
                continue;
            }
            $field = $base + $extra;
            $fields[] = $field;
        }
        acf_add_local_field_group([
            'key' => 'group_zero_' . $collection,
            'title' => (string) ($schema->collection($collection)['label'] ?? $collection),
            'fields' => $fields,
            'location' => [[['param' => 'user_form', 'operator' => '==', 'value' => 'all']]],
            'active' => true,
        ]);
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
        $this->writePassword((int) $id, $values);
        $this->writeMeta($spec, (int) $id, $values);
        $this->db->onRollback(static fn () => clean_user_cache((int) $id));

        return (int) $id;
    }

    public function update(string $collection, int|string $pk, array $values): void
    {
        $spec = $this->schema->collection($collection);
        $id = (int) $pk;
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
        $this->db->onRollback(static fn () => clean_user_cache($id));
    }

    public function delete(string $collection, int|string $pk): void
    {
        require_once ABSPATH . 'wp-admin/includes/user.php';
        $id = (int) $pk;
        $this->db->core(static fn () => wp_delete_user($id));
        $this->db->onRollback(static fn () => clean_user_cache($id));
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
            $value = $stored === null ? null : match ($spec['columns'][$col]['type'] ?? '') {
                'select' => json_decode((string) $stored, true),   // SCF stores the array (serialized)
                'boolean' => $stored ? '1' : '0',
                default => (string) $stored,
            };
            $this->db->core(static fn () => $value === null
                ? delete_user_meta($id, self::META . $col)
                : update_user_meta($id, self::META . $col, wp_slash($value)));
        }
    }

    /** Declared unique usermeta columns hold no duplicate (email is wp_users' own, checked apart). */
    private function checkUnique(array $spec, array $values, int $self): void
    {
        foreach ($values as $col => $stored) {
            $col = (string) $col;
            if ($stored === null || $col === 'email' || !($spec['columns'][$col]['unique'] ?? false) || in_array($col, [$spec['primaryKey'], 'name', 'role'], true)) {
                continue;
            }
            $hit = $this->db->run(
                'SELECT user_id FROM `' . $this->db->wpdb()->usermeta . '` WHERE meta_key = ? AND meta_value = ? AND user_id <> ? LIMIT 1 FOR UPDATE',
                [self::META . $col, (string) $stored, $self],
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
