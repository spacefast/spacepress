<?php

declare(strict_types=1);

namespace Zero\Auth;

/**
 * The target-specific half of feature 4 (§6.2). Token responses are
 * `['accessToken', 'refreshToken', 'expiresIn', 'user' => User]` (+ `clientId` on WordPress).
 */
interface Issuer
{
    /** `GET /auth/config`. */
    public function config(bool $guests): array;

    /** Password grant; 404 where the issuer owns sign-in (WordPress). */
    public function password(string $name, string $password): array;

    /** Refresh grant with rotation; reuse revokes the family. 404 on WordPress. */
    public function refresh(string $refreshToken): array;

    /** A new guest user (role `guest`) signed in. */
    public function guest(): array;

    /** Turn the signed-in guest into a subscriber in place (standalone); 404 on WordPress (hosted screens). */
    public function upgrade(?array $user, string $name, string $password): array;

    /** End the current session's sign-in. */
    public function signOut(array $user): void;

    /** An auth-collection row was deleted: revoke every credential of that user id. */
    public function forget(int $userId): void;

    /** True where emails are verified by the issuer (then members can't set their own directly). */
    public function verifiesEmail(): bool;

    /** Consume a virtual `password` input on the auth collection. */
    public function acceptPassword(array &$data, string $password, ?array $existing): void;
}
