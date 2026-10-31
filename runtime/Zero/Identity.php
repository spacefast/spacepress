<?php

declare(strict_types=1);

namespace Zero;

use Zero\Auth\Issuer;
use Zero\Auth\Sessions;
use Zero\Store\SqliteStore;

/**
 * Standalone identity (§5.2, §6.2). Users live in `__zero_users`, or, when the app declares an
 * `auth: true` collection, in that collection's own table (its email is the login name).
 *
 * Credentials: phase-1 CLI tokens `zt_<40 base62>` (`__zero_tokens`, long-lived, for servers and
 * scripts) and sign-in sessions from `POST /auth/token` / `POST /auth/guest`: `za_` access and `zr_`
 * refresh tokens with rotation (Auth\Sessions). All are stored as sha256 hex. A user's effective
 * role is always their current row's; a suspended user's credentials answer 403 `suspended`.
 */
final class Identity implements Auth, Issuer
{
    private const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

    /** @var array{table: string, login: string, display: string, collection: ?string} */
    private array $users;
    private Sessions $sessions;
    /** @var ?array{string, string} the credential that authenticated this request: ['session'|'token', id] */
    private ?array $current = null;

    public function __construct(private readonly SqliteStore $store, ?Schema $schema = null)
    {
        $auth = $schema?->auth() ?? [];
        $collection = $auth['collection'] ?? null;
        $columns = $collection === null ? [] : $schema->collection($collection)['columns'];
        $this->users = $collection === null
            ? ['table' => '"__zero_users"', 'login' => 'name', 'display' => 'name', 'collection' => null]
            : ['table' => '"' . $collection . '"', 'login' => 'email', 'display' => isset($columns['name']) ? 'name' : 'email', 'collection' => $collection];
        $this->sessions = new Sessions($store, (int) ($auth['accessTtl'] ?? 300), (int) ($auth['refreshTtl'] ?? 2592000));
    }

    // ================================================================ Auth

    public function resolve(array $headers): ?array
    {
        $this->current = null;
        $header = $headers['authorization'] ?? '';
        if (preg_match('/^Bearer\s+(zt_[0-9A-Za-z]{40})\s*$/D', $header, $m)) {
            $token = $this->store->run('SELECT "id", "userId" FROM "__zero_tokens" WHERE "hash" = ? AND "revokedAt" IS NULL', [hash('sha256', $m[1])])->fetch();
            if ($token === false) {
                return null;
            }
            $this->store->run('UPDATE "__zero_tokens" SET "lastUsedAt" = ? WHERE "id" = ?', [Js::iso(Js::now()), (int) $token['id']]);
            [$userId, $current] = [(int) $token['userId'], ['token', (string) $token['id']]];
        } elseif (preg_match('/^Bearer\s+(za_\S*)\s*$/D', $header, $m)) {
            // A sign-in token that doesn't resolve is an error, not an anonymous request: the
            // client refreshes on 401, and a suspended account learns why.
            $session = $this->sessions->resolve($m[1]) ?? throw self::rejected();
            $row = $this->row('"id" = ?', [$session[1]]) ?? throw self::rejected();
            self::live($row);
            if (!$session[2]) {
                throw self::rejected();
            }
            $this->current = ['session', $session[0]];

            return self::shape($row);
        } else {
            return null;
        }
        $row = $this->row('"id" = ?', [$userId]);
        if ($row === null) {
            return null;
        }
        self::live($row);
        $this->current = $current;

        return self::shape($row);
    }

    public function user(int $id): ?array
    {
        $row = $this->row('"id" = ?', [$id]);

        return $row === null ? null : self::shape($row);
    }

    // ================================================================ Issuer (§6.2)

    public function config(bool $guests): array
    {
        return ['issuer' => null, 'guests' => $guests];
    }

    public function password(string $name, string $password): array
    {
        $row = $this->row($this->q($this->users['login']) . ' = ?', [$name]);
        if ($row === null || $row['passwordHash'] === null || !password_verify($password, (string) $row['passwordHash'])) {
            throw new HttpError(401, 'unauthenticated', 'Wrong name or password');
        }
        self::live($row);

        return $this->sessions->issue((int) $row['id']) + ['user' => self::shape($row)];
    }

    public function refresh(string $refreshToken): array
    {
        [$userId, $tokens] = $this->sessions->rotate($refreshToken, function (int $id): void {
            $row = $this->row('"id" = ?', [$id]) ?? throw new HttpError(401, 'unauthenticated', 'The refresh token is invalid, expired or revoked');
            self::live($row);
        });

        return $tokens + ['user' => $this->user($userId)];
    }

    public function guest(): array
    {
        $tag = bin2hex(random_bytes(8));
        if ($this->users['collection'] === null) {
            $this->store->run(
                'INSERT INTO "__zero_users" ("name", "role", "guest", "createdAt") VALUES (?, ?, 1, ?)',
                ["guest-$tag", 'guest', Js::iso(Js::now())],
            );
            $id = (int) $this->store->pdo()->lastInsertId();
        } else {
            $values = ['email' => "guest-$tag@guest.invalid", 'role' => 'guest', 'guest' => true];
            if ($this->users['display'] === 'name') {
                $values['name'] = 'Guest';
            }
            $id = (int) db()->insert($this->users['collection'], $values, true)[0]['id'];
        }

        return $this->sessions->issue($id) + ['user' => $this->user($id)];
    }

    public function upgrade(?array $user, string $name, string $password): array
    {
        if ($user === null) {
            throw new HttpError(401, 'unauthenticated', 'Sign in as the guest first');
        }
        $row = $this->row('"id" = ?', [$user['id']]);
        if ($row === null || !(int) $row['guest']) {
            throw new HttpError(409, 'not_guest', 'Only a guest account can be upgraded');
        }
        if (strlen($password) < 12) {
            throw HttpError::invalidInput('password must be a string of at least 12 characters', '/password');
        }
        $hash = password_hash($password, PASSWORD_DEFAULT);
        if ($this->users['collection'] === null) {
            if (trim($name) === '') {
                throw HttpError::invalidInput('name is required', '/name');
            }
            if ($this->row('"name" = ? AND "id" <> ?', [$name, $user['id']]) !== null) {
                throw new HttpError(409, 'unique_violation', "A user named '$name' already exists", '/name');
            }
            $this->store->run('UPDATE "__zero_users" SET "name" = ?, "passwordHash" = ?, "guest" = 0, "role" = ? WHERE "id" = ?', [$name, $hash, 'subscriber', $user['id']]);
        } else {
            try {
                db()->update($this->users['collection'], ['email' => $name, 'passwordHash' => $hash, 'guest' => false, 'role' => 'subscriber'], ['id' => $user['id']], true);
            } catch (HttpError $e) {
                throw new HttpError($e->status, $e->errorCode, $e->getMessage(), $e->pointer === '/email' ? '/name' : $e->pointer);
            }
        }

        return $this->user($user['id']) ?? throw new \RuntimeException('Upgraded user vanished');
    }

    public function signOut(array $user): void
    {
        [$kind, $id] = $this->current ?? throw new HttpError(401, 'unauthenticated', 'Sign in first');
        if ($kind === 'session') {
            $this->sessions->end($id);
        } else {
            $this->revokeToken((int) $id);
        }
    }

    public function acceptPassword(array &$data, string $password, ?array $existing): void
    {
        $data['passwordHash'] = password_hash($password, PASSWORD_DEFAULT);
        if ($existing !== null) {
            // A new password ends every sign-in made with the old one.
            $this->sessions->revokeUser((int) $existing['id']);
        }
    }

    // ================================================================ CLI operations

    public function addUser(string $name, string $role, ?string $password): array
    {
        self::checkRole($role);
        if (trim($name) === '') {
            throw HttpError::invalidInput('name is required', '/name');
        }
        if ($this->findUser($name) !== null) {
            throw new HttpError(409, 'unique_violation', "A user named '$name' already exists", '/name');
        }
        $hash = $password === null ? null : password_hash($password, PASSWORD_DEFAULT);
        if ($this->users['collection'] === null) {
            $this->store->run(
                'INSERT INTO "__zero_users" ("name", "role", "passwordHash", "createdAt") VALUES (?, ?, ?, ?)',
                [$name, $role, $hash, Js::iso(Js::now())],
            );
            $id = (int) $this->store->pdo()->lastInsertId();
        } else {
            $values = ['email' => $name, 'role' => $role, 'passwordHash' => $hash, 'guest' => false];
            if ($this->users['display'] === 'name') {
                $values['name'] = substr(strstr($name, '@', true) ?: $name, 0, 80);
            }
            $id = (int) db()->insert($this->users['collection'], $values, true)[0]['id'];
        }

        return $this->user($id) ?? throw new \RuntimeException('User vanished');
    }

    /** @return list<array{id: int, name: string, role: string}> */
    public function listUsers(): array
    {
        return array_map(self::shape(...), $this->rows('1 = 1', []));
    }

    public function setRole(string $name, string $role): array
    {
        self::checkRole($role);
        $user = $this->requireUser($name);
        $this->store->run('UPDATE ' . $this->users['table'] . ' SET "role" = ? WHERE "id" = ?', [$role, $user['id']]);

        return ['role' => $role] + $user;
    }

    /** `users suspend|reactivate`: suspension blocks every credential and ends sign-in sessions. */
    public function suspend(string $name, bool $suspend): array
    {
        $user = $this->requireUser($name);
        $this->store->run('UPDATE ' . $this->users['table'] . ' SET "suspendedAt" = ? WHERE "id" = ?', [$suspend ? Js::iso(Js::now()) : null, $user['id']]);
        if ($suspend) {
            $this->sessions->revokeUser($user['id']);
        }

        return $user + ['suspended' => $suspend];
    }

    public function removeUser(string $name): array
    {
        $user = $this->requireUser($name);
        $this->store->run('DELETE FROM "__zero_tokens" WHERE "userId" = ?', [$user['id']]);
        $this->store->run('DELETE FROM "__zero_sessions" WHERE "userId" = ?', [$user['id']]);
        if ($this->users['collection'] === null) {
            $this->store->run('DELETE FROM "__zero_users" WHERE "id" = ?', [$user['id']]);
        } else {
            db()->delete($this->users['collection'], ['id' => $user['id']]);
        }

        return $user;
    }

    /** @return array{token: string, id: int} */
    public function createToken(string $userName, ?string $label): array
    {
        $user = $this->requireUser($userName);

        return $this->mint($user['id'], $label ?? 'cli');
    }

    /** @return list<array> */
    public function listTokens(?string $userName): array
    {
        $sql = 'SELECT t."id", t."name", t."role", u.' . $this->q($this->users['login']) . ' AS "user", t."createdAt", t."lastUsedAt", t."revokedAt" FROM "__zero_tokens" t JOIN ' . $this->users['table'] . ' u ON u."id" = t."userId"';
        $params = [];
        if ($userName !== null) {
            $sql .= ' WHERE t."userId" = ?';
            $params[] = $this->requireUser($userName)['id'];
        }

        return array_map(
            static fn (array $r) => ['id' => (int) $r['id']] + $r,
            $this->store->run($sql . ' ORDER BY t."id"', $params)->fetchAll(),
        );
    }

    public function revokeToken(int $id): array
    {
        $row = $this->store->run('SELECT "id", "revokedAt" FROM "__zero_tokens" WHERE "id" = ?', [$id])->fetch();
        if ($row === false) {
            throw HttpError::notFound("No token $id");
        }
        $at = $row['revokedAt'] ?? Js::iso(Js::now());
        $this->store->run('UPDATE "__zero_tokens" SET "revokedAt" = ? WHERE "id" = ?', [$at, $id]);

        return ['id' => $id, 'revokedAt' => $at];
    }

    // ================================================================ helpers

    /** @return array{token: string, id: int} */
    private function mint(int $userId, string $label): array
    {
        $user = $this->user($userId) ?? throw HttpError::notFound("No user $userId");
        $token = 'zt_';
        for ($i = 0; $i < 40; $i++) {
            $token .= self::BASE62[random_int(0, 61)];
        }
        $this->store->run(
            'INSERT INTO "__zero_tokens" ("userId", "name", "role", "hash", "createdAt") VALUES (?, ?, ?, ?, ?)',
            [$userId, $label, $user['role'], hash('sha256', $token), Js::iso(Js::now())],
        );

        return ['token' => $token, 'id' => (int) $this->store->pdo()->lastInsertId()];
    }

    private function q(string $column): string
    {
        return '"' . $column . '"';
    }

    /** @return list<array> rows with id, name (display), role, passwordHash, suspendedAt, guest */
    private function rows(string $where, array $params): array
    {
        $sql = 'SELECT "id", ' . $this->q($this->users['display']) . ' AS "name", "role", "passwordHash", "suspendedAt", "guest" FROM '
            . $this->users['table'] . " WHERE $where ORDER BY \"id\"";

        return $this->store->run($sql, $params)->fetchAll();
    }

    private function row(string $where, array $params): ?array
    {
        return $this->rows($where, $params)[0] ?? null;
    }

    private function findUser(string $name): ?array
    {
        $row = $this->row($this->q($this->users['login']) . ' = ?', [$name]);

        return $row === null ? null : self::shape($row);
    }

    private function requireUser(string $name): array
    {
        return $this->findUser($name) ?? throw HttpError::notFound("No user named '$name'");
    }

    private static function rejected(): HttpError
    {
        return new HttpError(401, 'unauthenticated', 'The access token is invalid, expired or revoked');
    }

    private static function live(array $row): void
    {
        if ($row['suspendedAt'] !== null) {
            throw new HttpError(403, 'suspended', 'This account is suspended');
        }
    }

    private static function checkRole(string $role): void
    {
        if (!in_array($role, Schema::ROLES, true)) {
            throw HttpError::invalidInput('role must be one of: ' . implode(', ', Schema::ROLES), '/role');
        }
    }

    /** @return array{id: int, name: string, role: string} */
    private static function shape(array $r): array
    {
        return ['id' => (int) $r['id'], 'name' => (string) $r['name'], 'role' => (string) $r['role']];
    }
}
