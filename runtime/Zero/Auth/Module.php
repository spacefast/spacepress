<?php

declare(strict_types=1);

namespace Zero\Auth;

use Zero\App;
use Zero\Extensions;
use Zero\HttpError;
use Zero\Js;
use Zero\Response;
use Zero\Schema;
use Zero\Store;
use Zero\Store\SqliteStore;
use Zero\SystemTables;
use Zero\Viewer;

use function Zero\db;

/**
 * Feature 4 (§6.2) on both targets: the `/auth/*` routes, `GET /me`, and the auth-collection
 * guards every read and write path goes through:
 *
 * - hidden columns (`passwordHash`, `suspendedAt`, `guest`) are stripped from every row the API
 *   serializes (list, get, `with`, revisions, write results) and refused in filters, ordering
 *   and `columns` selections, also through relation filters;
 * - `password` is a write-only virtual input: hashed into `passwordHash` (standalone) or set
 *   with `wp_set_password` (WordPress), never echoed;
 * - `role` is writable by admins only (its column `access.update` rule, enforced here too so it
 *   holds without the field-access lane) and system columns can't be written directly.
 *
 * The target-specific halves live behind the `Issuer` interface: `Standalone` (passwords, `za_`
 * sessions) and `Wp\IdentityBridge` (zero-identity).
 */
final class Module
{
    public const HIDDEN_FILTER = 'cannot be filtered or ordered on';
    private static ?Issuer $issuer = null;

    public static function register(): void
    {
        // Standalone only: WordPress keeps users in wp_users and sessions in zero-identity.
        SystemTables::register(Throttle::TABLE, Throttle::ddl(), []);
        SystemTables::register(Sessions::TABLE, [
            ...Sessions::ddl(),
            static function (Store $store): void {
                if (!$store instanceof SqliteStore) {
                    return;
                }
                $have = array_column($store->run('PRAGMA table_info("__zero_users")')->fetchAll(), 'name');
                foreach (['suspendedAt' => 'text', 'email' => 'text', 'guest' => 'integer NOT NULL DEFAULT 0'] as $col => $type) {
                    if (!in_array($col, $have, true)) {
                        $store->applySystemStatements(["ALTER TABLE \"__zero_users\" ADD COLUMN \"$col\" $type"]);
                    }
                }
                $store->applySystemStatements(['CREATE UNIQUE INDEX IF NOT EXISTS "__zero_users_email" ON "__zero_users" ("email")']);
                // CLI tokens may belong to an auth collection's users, not only __zero_users: drop
                // the phase-1 foreign key (Identity removes a user's tokens itself).
                $ddl = (string) $store->run("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '__zero_tokens'")->fetchColumn();
                if (str_contains($ddl, 'REFERENCES')) {
                    $store->applySystemStatements([
                        'CREATE TABLE "__zero_tokens_new" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "userId" integer NOT NULL, "name" text NOT NULL, "role" text NOT NULL, "hash" text NOT NULL UNIQUE, "createdAt" text NOT NULL, "lastUsedAt" text, "revokedAt" text)',
                        'INSERT INTO "__zero_tokens_new" SELECT "id", "userId", "name", "role", "hash", "createdAt", "lastUsedAt", "revokedAt" FROM "__zero_tokens"',
                        'DROP TABLE "__zero_tokens"',
                        'ALTER TABLE "__zero_tokens_new" RENAME TO "__zero_tokens"',
                    ]);
                }
            },
        ], []);
        Extensions::route('auth', self::route(...));
        Extensions::beforeRead(self::guardQuery(...));
        Extensions::onRead(self::strip(...));
        Extensions::normalizeWrite(self::password(...));
        Extensions::onWrite(self::guardWrite(...));
        Extensions::onWritten(self::forgetDeleted(...));
        Extensions::schemaDescribe(self::describe(...));
    }

    /** The target installs its issuer when it boots (standalone App::boot, WP Plugin::app). */
    public static function use(?Issuer $issuer): void
    {
        self::$issuer = $issuer;
    }

    public static function issuer(): ?Issuer
    {
        return self::$issuer;
    }

    // ================================================================ routes

    /** @return array{int, mixed}|Response */
    public static function route(string $method, array $segments, array $query, string $body, Viewer $viewer, array $files, array $form): array|Response
    {
        $path = implode('/', $segments);
        $issuer = self::$issuer;
        $guests = (bool) (db()->schema()->auth()['guests'] ?? true);
        $in = static fn (): array => self::object($body);
        switch ($path) {
            case 'auth/config':
                App::allow($method, ['GET']);

                return [200, $issuer?->config($guests) ?? ['issuer' => null, 'guests' => false]];
            case 'auth/token':
                App::allow($method, ['POST']);
                $issuer ?? throw HttpError::notFound('Sign in through the identity issuer on this target');
                $data = $in();

                try {
                    return [200, match ($data['grant_type'] ?? 'password') {
                        'password' => self::user($issuer->password(self::string($data, 'name'), self::string($data, 'password'))),
                        'refresh_token' => self::user($issuer->refresh(self::string($data, 'refreshToken'))),
                        default => throw HttpError::invalidInput('grant_type must be password or refresh_token', '/grant_type'),
                    }];
                } catch (Reused $reused) {
                    // The family revocation or throttle count commits with this transaction; the client still gets the error.
                    return Response::raw(Js::jsonStringify(App::problem($reused->error)) ?? '{}', $reused->error->status, ['Content-Type' => 'application/problem+json']);
                }
            case 'auth/guest':
                App::allow($method, ['POST']);
                if ($issuer === null || !$guests) {
                    throw HttpError::notFound('Guests are not enabled');
                }

                return [201, self::user($issuer->guest())];
            case 'auth/guest/upgrade':
                App::allow($method, ['POST']);
                $issuer ?? throw HttpError::notFound('Guests are not enabled');
                $data = $in();

                return [200, ['user' => self::present($issuer->upgrade($viewer->user, self::string($data, 'name'), self::string($data, 'password')))]];
            case 'auth/session':
                App::allow($method, ['DELETE']);
                $issuer ?? throw HttpError::notFound('Sessions belong to WordPress on this target');
                if ($viewer->user === null) {
                    throw new HttpError(401, 'unauthenticated', 'Sign in first');
                }
                $issuer->signOut($viewer->user);

                return [200, true];
        }
        throw HttpError::notFound('No route for /' . $path);
    }

    /** `GET /me`: the user plus their auth-collection row (`member`) when the app has one. */
    public static function me(?array $user): ?array
    {
        return $user === null ? null : self::present($user);
    }

    private static function present(array $user): array
    {
        $collection = db()->schema()->auth()['collection'] ?? null;
        if ($collection === null) {
            return $user;
        }

        // Read as the user themself, so field access and "self" apply exactly as on GET /members;
        // a read rule that keeps users from their own row yields no member, never a failed sign-in.
        try {
            $member = db()->findFirst($collection, ['where' => ['id' => $user['id']]], new Viewer($user, db()->target()));
        } catch (HttpError $e) {
            if (!in_array($e->status, [401, 403], true)) {
                throw $e;
            }
            $member = null;
        }

        return $user + ['member' => $member];
    }

    /** Token responses carry the user like `/me` does. */
    private static function user(array $tokens): array
    {
        $tokens['user'] = self::present($tokens['user']);

        return $tokens;
    }

    // ================================================================ guards

    /** @return array<string, true> hidden columns of a collection */
    public static function hidden(string $collection): array
    {
        $out = [];
        $schema = db()->schema();
        if (!$schema->hasCollection($collection)) {
            return [];
        }
        foreach ($schema->collection($collection)['columns'] as $name => $col) {
            if ($col['hidden'] ?? false) {
                $out[(string) $name] = true;
            }
        }

        return $out;
    }

    /** Hidden columns never reach a query, at any depth (`where`, relation filters, `orderBy`, `columns`, `with`). */
    public static function guardQuery(string $collection, array &$opts, ?Viewer $viewer, string $pointer): void
    {
        if ($viewer === null) {
            return;
        }
        self::guardFilter($collection, $opts['where'] ?? null, $pointer . '/where');
        $hidden = self::hidden($collection);
        $order = $opts['orderBy'] ?? null;
        foreach (is_array($order) ? array_keys($order) : [] as $col) {
            if (isset($hidden[(string) $col])) {
                throw new HttpError(403, 'forbidden', "$col " . self::HIDDEN_FILTER, $pointer . '/orderBy' . HttpError::seg($col));
            }
        }
        $columns = $opts['columns'] ?? null;
        foreach (is_array($columns) ? array_keys($columns) : [] as $col) {
            if (isset($hidden[(string) $col])) {
                throw new HttpError(403, 'forbidden', "$col can't be selected", $pointer . '/columns' . HttpError::seg($col));
            }
        }
    }

    private static function guardFilter(string $collection, mixed $where, string $ptr): void
    {
        if (!is_array($where)) {
            return;
        }
        if (!db()->schema()->hasCollection($collection)) {
            return;
        }
        $spec = db()->schema()->collection($collection);
        $hidden = self::hidden($collection);
        foreach ($where as $key => $value) {
            $key = (string) $key;
            $kptr = $ptr . HttpError::seg($key);
            if (isset($hidden[$key])) {
                throw new HttpError(403, 'forbidden', "$key " . self::HIDDEN_FILTER, $kptr);
            }
            if (in_array($key, ['AND', 'OR'], true) && is_array($value)) {
                foreach ($value as $i => $f) {
                    self::guardFilter($collection, $f, "$kptr/$i");
                }
            } elseif ($key === 'NOT') {
                self::guardFilter($collection, $value, $kptr);
            } elseif (isset($spec['relations'][$key]) && is_array($value)) {
                self::guardFilter($spec['relations'][$key]['collection'], $value, $kptr);
            }
        }
    }

    /**
     * Hidden columns leave every row the API returns (any viewer); storage keeps them. The auth
     * collection's secrets go on trusted reads too (hooks, CLI): nothing in an app needs them, and
     * the issuer reads them itself. Other features' hidden metadata (a locale's translation group)
     * stays visible to trusted internal reads that maintain it.
     */
    public static function strip(array $rows, string $collection, ?Viewer $viewer): array
    {
        $isAuth = $collection === (db()->schema()->auth()['collection'] ?? null);
        $hidden = $viewer !== null || $isAuth ? self::hidden($collection) : [];
        if ($viewer === null && $isAuth) {
            $hidden = array_intersect_key($hidden, array_flip(['passwordHash', 'suspendedAt', 'guest']));
        }
        if ($hidden === []) {
            return $rows;
        }

        return array_map(static fn (array $row): array => array_diff_key($row, $hidden), $rows);
    }

    /** The virtual `password` input on the auth collection: hashed (standalone) or kept for WordPress. */
    public static function password(string $op, string $collection, array &$data, ?array $existing, ?Viewer $viewer, array $provided): void
    {
        if ($op === 'delete' || $collection !== (db()->schema()->auth()['collection'] ?? null) || !array_key_exists('password', $data)) {
            return;
        }
        $password = $data['password'];
        unset($data['password']);
        if (!is_string($password) || strlen($password) < 12 || strlen($password) > 1024 || str_contains($password, "\0")) {
            throw HttpError::invalidInput('password must be a string of at least 12 characters, without NUL', '/password');
        }
        if (self::$issuer !== null) {
            self::$issuer->acceptPassword($data, $password, $existing);
        } elseif (db()->target() === 'wp') {
            // No identity issuer: WordPress still owns the password (wp_set_password in WpUserStore).
            $data['passwordHash'] = \Zero\Wp\PendingPassword::put($password);
        } else {
            throw new \LogicException('The standalone issuer is always installed');
        }
    }

    /** API writes never set system columns of the auth collection directly, and only admins change `role`. */
    public static function guardWrite(string $op, string $collection, array &$data, ?array $existing, ?Viewer $viewer, array $provided): void
    {
        if ($viewer === null || $op === 'delete' || $collection !== (db()->schema()->auth()['collection'] ?? null)) {
            return;
        }
        foreach (array_keys(self::hidden($collection)) as $col) {
            if (array_key_exists($col, $provided)) {
                throw HttpError::invalidInput("Unknown field '$col'", HttpError::seg($col));
            }
        }
        $admin = $viewer->user !== null && Schema::roleRank($viewer->user['role']) >= Schema::roleRank('admin');
        if (array_key_exists('role', $provided)) {
            if (!$admin && !($op === 'update' && $existing !== null && $provided['role'] === $existing['role'])) {
                throw new HttpError(403, 'forbidden', 'Only admins can change role', '/role');
            }
        }
        // Where an identity issuer verifies emails (WordPress + zero-identity), a member's email is
        // what identity verified: only admins (imports, support) set it directly. Otherwise someone
        // could claim another person's address and inherit their account when they verify it.
        if ($op === 'update' && !$admin && array_key_exists('email', $provided) && $existing !== null
            && $provided['email'] !== $existing['email'] && (self::$issuer?->verifiesEmail() ?? false)) {
            throw new HttpError(403, 'forbidden', 'Change your email on the account screen, where it is verified', '/email');
        }
    }

    /** Every deleted member (API, CLI, cascades) loses its credentials in the same transaction. */
    public static function forgetDeleted(string $op, string $collection, array $row, ?array $previous): void
    {
        if ($op === 'delete' && $collection === (db()->schema()->auth()['collection'] ?? null)) {
            self::$issuer?->forget((int) $row['id']);
        }
    }

    /** `/_schema` never names hidden columns. */
    public static function describe(array $describe): array
    {
        foreach ($describe['collections'] as $name => $c) {
            foreach ($c['columns'] as $col => $def) {
                if ($def['hidden'] ?? false) {
                    unset($describe['collections'][$name]['columns'][$col]);
                }
            }
        }

        return $describe;
    }

    // ================================================================ helpers

    private static function object(string $body): array
    {
        try {
            $v = trim($body) === '' ? [] : json_decode($body, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON: ' . $e->getMessage());
        }
        if (!is_array($v) || ($v !== [] && array_is_list($v))) {
            throw HttpError::invalidInput('Body must be a JSON object', '');
        }

        return $v;
    }

    private static function string(array $data, string $key): string
    {
        return is_string($data[$key] ?? null) ? $data[$key] : throw HttpError::invalidInput("$key is required", HttpError::seg($key));
    }
}
