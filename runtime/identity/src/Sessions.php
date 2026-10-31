<?php

declare(strict_types=1);

namespace Zero\Identity;

final class Sessions
{
    public const COOKIE = "zi_session";
    public function __construct(private DB $db, private Security $security) {}
    public function create(int $uid): array
    {
        return $this->db->transaction(function () use ($uid) {
            $this->db->lock($uid);
            $secret = Security::token();
            $session = [
                "id" => bin2hex(random_bytes(16)),
                "wp_user_id" => $uid,
                "secret_hash" => SessionLookup::digest($secret),
                "csrf" => bin2hex(random_bytes(32)),
                "created_at" => time(),
                "expires_at" => time() + 86400,
                "verified_at" => time(),
                "label" => substr(
                    sanitize_text_field(
                        $_SERVER["HTTP_USER_AGENT"] ?? "Server session",
                    ),
                    0,
                    200,
                ),
            ];
            $this->db->insert("sessions", $session);
            $this->security->event($uid, "session.created");
            return ["secret" => $secret, "session" => $session];
        });
    }
    public function find(string $secret): ?array
    {
        return SessionLookup::find(
            $this->db->row(...),
            $this->db->prefix,
            $secret,
            time(),
        );
    }
    public function require(?string $csrf = null): array
    {
        $session = $this->find((string) ($_COOKIE[self::COOKIE] ?? ""));
        if (!$session) {
            throw new Failure("unauthenticated", "Sign in to continue.", 401);
        }
        if ($csrf !== null && !hash_equals($session["csrf"], $csrf)) {
            throw new Failure(
                "invalid_csrf",
                "Refresh the page and try again.",
                403,
            );
        }
        return $session;
    }
    public function recent(array $session): void
    {
        if ((int) $session["verified_at"] < time() - 300) {
            throw new Failure(
                "reverification_required",
                "Confirm it is you before continuing.",
                403,
            );
        }
    }
    public function reverify(array $s): void
    {
        $this->db->transaction(function () use ($s) {
            $this->db->lock((int) $s["wp_user_id"]);
            $live = $this->db->row(
                "SELECT * FROM {$this->db->prefix}sessions WHERE id=%s AND wp_user_id=%d FOR UPDATE",
                $s["id"],
                $s["wp_user_id"],
            );
            if (
                !$live ||
                $live["revoked_at"] !== null ||
                (int) $live["expires_at"] <= time()
            ) {
                throw new Failure(
                    "unauthenticated",
                    "This session expired or was revoked.",
                    401,
                );
            }
            $this->db->run(
                "UPDATE {$this->db->prefix}sessions SET verified_at=%d WHERE id=%s",
                time(),
                $s["id"],
            );
        });
    }
    public function revoke(int $uid, ?string $id = null): void
    {
        $this->db->transaction(function () use ($uid, $id) {
            $this->db->run(
                "SELECT wp_user_id FROM {$this->db->prefix}accounts WHERE wp_user_id=%d FOR UPDATE",
                $uid,
            );
            $this->db->run(
                "UPDATE {$this->db->prefix}sessions SET revoked_at=%d WHERE wp_user_id=%d" .
                    ($id === null ? "" : " AND id=%s"),
                ...$id === null ? [time(), $uid] : [time(), $uid, $id],
            );
            if ($id === null) {
                // Sign-ins waiting on a second factor started before this revocation end too,
                // including one whose challenge was just consumed and is waiting on this lock.
                $this->db->run(
                    "UPDATE {$this->db->prefix}challenges SET expires_at=0 WHERE wp_user_id=%d AND purpose='mfa' AND expires_at>0",
                    $uid,
                );
            }
        });
        if ($id === null) {
            \WP_Session_Tokens::get_instance($uid)->destroy_all();
        }
        $this->security->event(
            $uid,
            $id === null ? "session.global_revoked" : "session.revoked",
        );
    }
    public static function cookie(string $secret, int $expires): void
    {
        setcookie(self::COOKIE, $secret, [
            "expires" => $expires,
            "path" => "/",
            "secure" => is_ssl(),
            "httponly" => true,
            "samesite" => "Lax",
        ]);
    }
}
