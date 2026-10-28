<?php

declare(strict_types=1);

namespace Zero;

use Zero\Store\SqliteStore;

/**
 * Standalone auth (§5.2): users in __zero_users, bearer tokens `zt_<40 base62>` in __zero_tokens,
 * stored as sha256 hex. The plaintext is returned once, at creation.
 *
 * A token's effective role is its user's current role (`__zero_tokens.role` records the role at
 * mint time, for `token list`); changing a user's role therefore applies to existing tokens.
 */
final class Identity implements Auth
{
    private const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

    public function __construct(private readonly SqliteStore $store)
    {
    }

    public function resolve(array $headers): ?array
    {
        $auth = $headers['authorization'] ?? '';
        if (!preg_match('/^Bearer\s+(zt_[0-9A-Za-z]{40})\s*$/D', $auth, $m)) {
            return null;
        }
        $row = $this->store->run(
            'SELECT t."id" AS "tokenId", u."id", u."name", u."role" FROM "__zero_tokens" t JOIN "__zero_users" u ON u."id" = t."userId" WHERE t."hash" = ? AND t."revokedAt" IS NULL',
            [hash('sha256', $m[1])],
        )->fetch();
        if ($row === false) {
            return null;
        }
        $this->store->run('UPDATE "__zero_tokens" SET "lastUsedAt" = ? WHERE "id" = ?', [Js::iso(Js::now()), (int) $row['tokenId']]);

        return self::shape($row);
    }

    public function user(int $id): ?array
    {
        $row = $this->store->run('SELECT "id", "name", "role" FROM "__zero_users" WHERE "id" = ?', [$id])->fetch();

        return $row === false ? null : self::shape($row);
    }

    public function login(string $name, string $password): array
    {
        $row = $this->store->run('SELECT "id", "name", "role", "passwordHash" FROM "__zero_users" WHERE "name" = ?', [$name])->fetch();
        if ($row === false || $row['passwordHash'] === null || !password_verify($password, (string) $row['passwordHash'])) {
            throw new HttpError(401, 'unauthenticated', 'Wrong name or password');
        }
        $minted = $this->mint((int) $row['id'], 'login');

        return ['token' => $minted['token'], 'user' => self::shape($row)];
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
        $this->store->run(
            'INSERT INTO "__zero_users" ("name", "role", "passwordHash", "createdAt") VALUES (?, ?, ?, ?)',
            [$name, $role, $password === null ? null : password_hash($password, PASSWORD_DEFAULT), Js::iso(Js::now())],
        );

        return $this->user((int) $this->store->pdo()->lastInsertId()) ?? throw new \RuntimeException('User vanished');
    }

    /** @return list<array{id: int, name: string, role: string}> */
    public function listUsers(): array
    {
        return array_map(self::shape(...), $this->store->run('SELECT "id", "name", "role" FROM "__zero_users" ORDER BY "id"')->fetchAll());
    }

    public function setRole(string $name, string $role): array
    {
        self::checkRole($role);
        $user = $this->requireUser($name);
        $this->store->run('UPDATE "__zero_users" SET "role" = ? WHERE "id" = ?', [$role, $user['id']]);

        return ['role' => $role] + $user;
    }

    public function removeUser(string $name): array
    {
        $user = $this->requireUser($name);
        $this->store->run('DELETE FROM "__zero_tokens" WHERE "userId" = ?', [$user['id']]);
        $this->store->run('DELETE FROM "__zero_users" WHERE "id" = ?', [$user['id']]);

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
        $sql = 'SELECT t."id", t."name", t."role", u."name" AS "user", t."createdAt", t."lastUsedAt", t."revokedAt" FROM "__zero_tokens" t JOIN "__zero_users" u ON u."id" = t."userId"';
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

    private function findUser(string $name): ?array
    {
        $row = $this->store->run('SELECT "id", "name", "role" FROM "__zero_users" WHERE "name" = ?', [$name])->fetch();

        return $row === false ? null : self::shape($row);
    }

    private function requireUser(string $name): array
    {
        return $this->findUser($name) ?? throw HttpError::notFound("No user named '$name'");
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
