<?php

declare(strict_types=1);

namespace Zero\Identity;

/**
 * `Authorization: Bearer <access token>` on WordPress: a `determine_current_user` filter at
 * priority 20, after core's cookie and application-password resolvers, with the same checks as
 * UserInfo (signature, issuer, expiry, unrevoked jti and session, active account, enabled app).
 *
 * A presented token that does not resolve is an authentication error, not an anonymous request:
 * `rest_authentication_errors` answers 401 `invalid_token` (403 `suspended` when the signature is
 * ours but the account is suspended or deleted). A consumer that renders its own errors can take
 * the reason through `failure()` and opt out with the `zero_identity_bearer_error` filter.
 */
final class Bearer
{
    private static ?string $failure = null;
    private static ?array $token = null;

    public static function resolve(mixed $userId): mixed
    {
        if ($userId) {
            return $userId;
        }
        $raw = self::header();
        if ($raw === null) {
            return $userId;
        }
        $token = (new OAuth(Plugin::$db, Plugin::$accounts))->access($raw);
        if ($token === null) {
            $claims = Keys::verify($raw, true);
            $status = $claims !== null && is_string($claims["sub"] ?? null) && ctype_digit($claims["sub"])
                ? Plugin::$accounts->status((int) $claims["sub"])
                : "none";
            self::$failure = in_array($status, ["suspended", "deletion_requested", "deleted"], true) ? "suspended" : "invalid_token";
            return $userId;
        }
        self::$failure = null;
        self::$token = $token;
        return $token["uid"];
    }

    /** rest_authentication_errors: a failed Bearer becomes an error unless a consumer handles it. */
    public static function errors(mixed $error): mixed
    {
        if ($error !== null || self::$failure === null) {
            return $error;
        }
        $suspended = self::$failure === "suspended";
        $wpError = new \WP_Error(
            self::$failure,
            $suspended ? "This account is suspended." : "The access token is invalid, expired or revoked.",
            ["status" => $suspended ? 403 : 401],
        );
        return apply_filters("zero_identity_bearer_error", $wpError, self::$failure);
    }

    /** Why the presented Bearer token failed this request: 'invalid_token', 'suspended' or null. */
    public static function failure(): ?string
    {
        return self::$failure;
    }

    /** The access token that authenticated this request (null for cookies/app passwords). */
    public static function token(): ?array
    {
        return self::$token;
    }

    private static function header(): ?string
    {
        $header = $_SERVER["HTTP_AUTHORIZATION"] ?? $_SERVER["REDIRECT_HTTP_AUTHORIZATION"] ?? "";
        if (!is_string($header) || !preg_match('/^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/D', $header, $m)) {
            return null;
        }
        return $m[1];
    }
}
