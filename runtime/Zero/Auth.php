<?php

declare(strict_types=1);

namespace Zero;

/*
 * CHANGED vs design §5 (additive): besides resolve(), user($id) names revision authors in
 * GET /{c}/{id}/revisions and login() backs POST /auth/token (WP: throw 404 not_found).
 */

/** Resolves a request to a User (§5). Standalone: Identity (bearer tokens). WP: Wp\WpAuth. */
interface Auth
{
    /**
     * The user making this request, or null when anonymous.
     *
     * @param array<string, string> $headers lower-cased header names
     * @return ?array{id: int, name: string, role: string}
     */
    public function resolve(array $headers): ?array;

    /**
     * Look a user up by id (revision authors). Null when unknown.
     *
     * @return ?array{id: int, name: string, role: string}
     */
    public function user(int $id): ?array;

    /**
     * `POST /auth/token` (§5.2). Returns ['token' => string, 'user' => User]. Throws HttpError 401
     * `unauthenticated` on a mismatch; targets without password login (WP) throw 404 `not_found`.
     */
    public function login(string $name, string $password): array;
}
