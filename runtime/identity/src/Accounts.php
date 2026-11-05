<?php

declare(strict_types=1);

namespace Zero\Identity;

final class Accounts
{
    public function __construct(private DB $db, private Security $security) {}
    public static function email(string $email): string
    {
        $email = strtolower(trim($email));
        if (
            strlen($email) > 254 ||
            !is_email($email) ||
            preg_match('/[^\x20-\x7e]/', $email)
        ) {
            throw new Failure("invalid_email", "Enter a valid email address.");
        }
        return $email;
    }
    public function ensure(int $uid): void
    {
        if (!get_userdata($uid)) {
            throw new Failure(
                "account_unavailable",
                "Account unavailable.",
                404,
            );
        }
        $this->db->run(
            "INSERT IGNORE INTO {$this->db->prefix}accounts (wp_user_id,created_at) VALUES (%d,%d)",
            $uid,
            time(),
        );
    }
    public function owner(string $email): int
    {
        $row = $this->db->row(
            "SELECT wp_user_id FROM {$this->db->prefix}emails WHERE normalized=%s",
            self::email($email),
        );
        return (int) ($row["wp_user_id"] ?? 0);
    }
    public function profile(int $uid): array
    {
        $this->ensure($uid);
        $a = $this->db->row(
            "SELECT * FROM {$this->db->prefix}accounts WHERE wp_user_id=%d",
            $uid,
        );
        $u = get_userdata($uid);
        $emails = $this->db->rows(
            "SELECT * FROM {$this->db->prefix}emails WHERE wp_user_id=%d ORDER BY id",
            $uid,
        );
        return [
            "id" => (string) $uid,
            "wp_user_id" => $uid,
            "name" => $u->display_name,
            "status" => $a["status"],
            "emails" => array_map(
                fn($e) => [
                    "id" => (string) $e["id"],
                    "email" => $e["normalized"],
                    "primary" =>
                        (string) $a["primary_email_id"] === (string) $e["id"],
                    "verified_at" => (int) $e["verified_at"],
                ],
                $emails,
            ),
            "providers" => array_map(
                fn($p) => ["id" => (string) $p["id"], "issuer" => $p["issuer"]],
                $this->db->rows(
                    "SELECT id,issuer FROM {$this->db->prefix}providers WHERE wp_user_id=%d",
                    $uid,
                ),
            ),
        ];
    }
    public function claim(int $uid, string $email, string $method): int
    {
        $email = self::email($email);
        $account = $this->db->lock($uid);
        $existing = $this->db->row(
            "SELECT * FROM {$this->db->prefix}emails WHERE normalized=%s",
            $email,
        );
        if ($existing) {
            if ((int) $existing["wp_user_id"] !== $uid) {
                throw new Failure(
                    "email_in_use",
                    "This address belongs to another account.",
                    409,
                );
            }
            return (int) $existing["id"];
        }
        $legacy = $this->db->rows(
            "SELECT ID FROM {$this->db->wp->users} WHERE LOWER(TRIM(user_email))=%s",
            $email,
        );
        foreach ($legacy as $user) {
            if ((int) $user["ID"] !== $uid) {
                throw new Failure(
                    "link_required",
                    "Sign in to the existing account before linking this email.",
                    409,
                );
            }
        }
        $id = $this->db->insert("emails", [
            "wp_user_id" => $uid,
            "normalized" => $email,
            "verified_at" => time(),
            "method" => $method,
        ]);
        if (!$account["primary_email_id"]) {
            $this->setPrimaryLocked($uid, $id, $email);
        }
        $this->security->event($uid, "email.verified", ["email_id" => $id]);
        return $id;
    }
    private function setPrimaryLocked(int $uid, int $id, string $email): void
    {
        $this->db->touch($uid);
        $this->db->run(
            "UPDATE {$this->db->prefix}accounts SET primary_email_id=%d WHERE wp_user_id=%d",
            $id,
            $uid,
        );
        $this->db->run(
            "UPDATE {$this->db->wp->users} SET user_email=%s WHERE ID=%d",
            $email,
            $uid,
        );
        clean_user_cache($uid);
    }
    public function primary(int $uid, int $id): void
    {
        $this->db->transaction(function () use ($uid, $id) {
            $this->db->lock($uid);
            $email = $this->db->row(
                "SELECT * FROM {$this->db->prefix}emails WHERE id=%d AND wp_user_id=%d",
                $id,
                $uid,
            );
            if (!$email) {
                throw new Failure(
                    "email_not_found",
                    "Verified email not found.",
                    404,
                );
            }
            $this->setPrimaryLocked($uid, $id, $email["normalized"]);
            $this->security->event($uid, "email.primary_changed", [
                "email_id" => $id,
            ]);
        });
    }
    public function removeEmail(int $uid, int $id): void
    {
        $this->db->transaction(function () use ($uid, $id) {
            $a = $this->db->lock($uid);
            if ((int) $a["primary_email_id"] === $id) {
                throw new Failure(
                    "primary_email_required",
                    "Choose another primary email before removing this one.",
                    409,
                );
            }
            $this->db->run(
                "DELETE FROM {$this->db->prefix}emails WHERE id=%d AND wp_user_id=%d",
                $id,
                $uid,
            );
            $this->security->event($uid, "email.removed", ["email_id" => $id]);
        });
    }
    private const DUMMY_PASSWORD_HASH = "zero_identity_dummy_password_hash";
    private const PASSWORD_PROFILES = "zero_identity_password_profiles";

    /** Persist fixed verification hashes once, including the site's existing WordPress hash profiles. */
    public static function provisionPasswordHash(): void
    {
        $hash = get_option(self::DUMMY_PASSWORD_HASH);
        if (!is_string($hash) || wp_password_needs_rehash($hash)) {
            $hash = wp_hash_password(Security::token(48));
            update_option(self::DUMMY_PASSWORD_HASH, $hash, false);
        }
        if (!is_array(get_option(self::PASSWORD_PROFILES))) {
            global $wpdb;
            $profiles = [self::passwordProfile($hash) => $hash];
            foreach (Plugin::$db->rows("SELECT user_pass FROM {$wpdb->users}") as $row) {
                $profile = self::passwordProfile($row['user_pass']);
                $profiles[$profile] ??= self::dummyPasswordHash($row['user_pass']);
            }
            update_option(self::PASSWORD_PROFILES, $profiles, false);
        }
        self::rememberPasswordHash($hash);
    }

    /** Keep profiles after upgrades: removing the last old hash must not change just its user's work. */
    public static function rememberPasswordHash(string $hash): void
    {
        $profile = self::passwordProfile($hash);
        $profiles = get_option(self::PASSWORD_PROFILES, []);
        if (!isset($profiles[$profile])) {
            Plugin::$db->transaction(static function () use ($profile, $hash): void {
                global $wpdb;
                $row = Plugin::$db->row("SELECT option_value FROM {$wpdb->options} WHERE option_name=%s FOR UPDATE", self::PASSWORD_PROFILES);
                $profiles = $row === null ? [] : unserialize($row['option_value'], ['allowed_classes' => false]);
                $profiles[$profile] ??= self::dummyPasswordHash($hash);
                update_option(self::PASSWORD_PROFILES, $profiles, false);
            });
        }
    }

    private static function passwordProfile(string $hash): string
    {
        if (strlen($hash) <= 32) {
            return 'md5';
        }
        if (str_starts_with($hash, '$P$') && strlen($hash) === 34) {
            return substr($hash, 0, 4);
        }
        $prefixed = str_starts_with($hash, '$wp');
        $encoded = $prefixed ? substr($hash, 3) : $hash;
        if (preg_match('/^\$2[abxy]\$(\d{2})\$[.\/A-Za-z0-9]{53}$/D', $encoded, $match)) {
            return json_encode([$prefixed, 'bcrypt', ['cost' => (int) $match[1]]]);
        }
        if (preg_match('/^\$([56])\$(?:rounds=(\d+)\$)?/', $encoded, $match)) {
            return json_encode([$prefixed, 'sha-crypt-' . $match[1], ['rounds' => (int) ($match[2] ?? 5000)]]);
        }
        if (str_starts_with($encoded, '$1$')) {
            return json_encode([$prefixed, 'md5-crypt']);
        }
        $info = password_get_info($encoded);
        // Unknown pluggable formats still reach WordPress's verifier.
        return $info['algo'] === null
            ? json_encode([$prefixed, 'opaque'])
            : json_encode([$prefixed, $info['algoName'], $info['options']]);
    }

    /** Generate independent verification material; never retain a user's credential hash. */
    private static function dummyPasswordHash(string $hash): string
    {
        $password = Security::token(48);
        if (strlen($hash) <= 32) {
            return md5($password);
        }
        if (str_starts_with($hash, '$P$') && strlen($hash) === 34) {
            require_once ABSPATH . WPINC . '/class-phpass.php';
            return (new \PasswordHash(8, true))->crypt_private($password, $hash);
        }
        $prefixed = str_starts_with($hash, '$wp');
        $encoded = $prefixed ? substr($hash, 3) : $hash;
        if ($prefixed) {
            $password = base64_encode(hash_hmac('sha384', $password, 'wp-sha384', true));
        }
        $info = password_get_info($encoded);
        $dummy = $info['algo'] === null ? crypt($password, $encoded) : password_hash($password, $info['algo'], $info['options']);
        if (strlen($dummy) <= 2) {
            // Pluggable formats without a PHP encoder still use independent verification material.
            return wp_hash_password(Security::token(48));
        }
        return ($prefixed ? '$wp' : '') . $dummy;
    }

    public function password(string $login, string $password): int
    {
        $uid = is_email($login) ? $this->owner($login) : 0;
        $user = $uid
            ? get_userdata($uid)
            : (is_email($login)
                ? get_user_by("email", $login)
                : get_user_by("login", $login));
        $profile = $user ? self::passwordProfile($user->user_pass) : null;
        if ($user) {
            self::rememberPasswordHash($user->user_pass);
        }
        $valid = false;
        // Every sign-in performs the same algorithm/cost schedule, including missing accounts.
        foreach (get_option(self::PASSWORD_PROFILES) as $kind => $dummy) {
            $actual = $user && $profile === $kind;
            $checked = wp_check_password($password, $actual ? $user->user_pass : $dummy, $actual ? $user->ID : 0);
            if ($actual) {
                $valid = $checked;
            }
        }
        if (!$user || !$valid) {
            throw new Failure(
                "invalid_credentials",
                "The sign-in details are incorrect.",
                401,
            );
        }
        $this->ensure((int) $user->ID);
        return (int) $user->ID;
    }
    public function emailLogin(string $email): int
    {
        $email = self::email($email);
        return $this->db->transaction(function () use ($email) {
            $uid = $this->owner($email);
            if (!$uid) {
                $legacy = $this->db->rows(
                    "SELECT ID FROM {$this->db->wp->users} WHERE LOWER(TRIM(user_email))=%s",
                    $email,
                );
                if (count($legacy) > 1) {
                    throw new Failure(
                        "ownership_conflict",
                        "Contact your administrator to resolve duplicate legacy emails.",
                        409,
                    );
                }
                $uid = (int) ($legacy[0]["ID"] ?? 0);
            }
            if (!$uid) {
                $uid = $this->create($email);
            }
            $this->ensure($uid);
            $this->claim($uid, $email, "email_code");
            return $uid;
        });
    }
    private function create(string $name): int
    {
        $uid = wp_insert_user([
            "user_login" => "zi_" . bin2hex(random_bytes(16)),
            "user_pass" => Security::token(48),
            "display_name" => $name,
            "role" => "subscriber",
        ]);
        if (is_wp_error($uid)) {
            throw new Failure(
                "account_creation_failed",
                "Account could not be created.",
                409,
            );
        }
        $this->ensure($uid);
        return $uid;
    }
    public function provider(
        string $issuer,
        string $subject,
        ?string $email,
        string $name,
        ?int $linkUid = null,
        ?string $linkSessionId = null,
    ): int {
        if (
            $issuer === "" ||
            strlen($issuer) > 255 ||
            $subject === "" ||
            strlen($subject) > 512
        ) {
            throw new Failure(
                "invalid_identity",
                "Provider identity is invalid.",
            );
        }
        $key = hash("sha256", $issuer . "\0" . $subject);
        return $this->db->transaction(function () use (
            $issuer,
            $subject,
            $email,
            $name,
            $linkUid,
            $key,
            $linkSessionId,
        ) {
            if ($linkUid !== null) {
                $this->db->lock($linkUid);
                $session = $this->db->row(
                    "SELECT * FROM {$this->db->prefix}sessions WHERE id=%s AND wp_user_id=%d FOR UPDATE",
                    $linkSessionId ?? "",
                    $linkUid,
                );
                if (
                    !$session ||
                    $session["revoked_at"] !== null ||
                    (int) $session["expires_at"] <= time() ||
                    (int) $session["verified_at"] < time() - 300
                ) {
                    throw new Failure(
                        "link_session_invalid",
                        "The linking session expired or was revoked. Sign in again.",
                        403,
                    );
                }
            }
            $existing = $this->db->row(
                "SELECT * FROM {$this->db->prefix}providers WHERE identity_key=%s",
                $key,
            );
            if ($existing) {
                $uid = (int) $existing["wp_user_id"];
                if ($linkUid !== null && $linkUid !== $uid) {
                    throw new Failure(
                        "provider_in_use",
                        "This provider belongs to another account.",
                        409,
                    );
                }
                $this->db->lock($uid);
                return $uid;
            }
            $uid = $linkUid;
            if (!$uid) {
                if (!$email) {
                    throw new Failure(
                        "verified_email_required",
                        "Sign in and explicitly link this provider, or verify an email first.",
                        409,
                    );
                }
                if ($this->owner($email) || get_user_by("email", $email)) {
                    throw new Failure(
                        "link_required",
                        "Sign in to your existing account, then link this provider in Account.",
                        409,
                    );
                }
                $uid = $this->create($name ?: $email);
            }
            $this->ensure($uid);
            $this->db->lock($uid);
            $this->db->insert("providers", [
                "wp_user_id" => $uid,
                "identity_key" => $key,
                "issuer" => $issuer,
                "subject" => $subject,
                "created_at" => time(),
            ]);
            if ($email !== null) {
                $this->claim($uid, $email, "oidc");
            }
            $this->security->event($uid, "provider.linked", [
                "issuer" => $issuer,
            ]);
            return $uid;
        });
    }
    /**
     * A WordPress user is being deleted: everything identity knows about it goes with it, in the
     * caller's transaction (sessions and tokens, verified emails, providers, passkeys, factors,
     * memberships, pending challenges and codes, the account). A later user given the same id, or
     * someone re-registering the email, starts with nothing of it.
     */
    public function forgetUser(int $uid): void
    {
        $this->db->transaction(function () use ($uid): void {
            foreach (["sessions", "tokens", "codes", "challenges", "emails", "providers", "passkeys", "mfa", "recovery_codes", "members", "accounts"] as $table) {
                $this->db->run("DELETE FROM {$this->db->prefix}{$table} WHERE wp_user_id=%d", $uid);
            }
        });
    }
    /** The account state the Zero runtime enforces on every channel (§3.5). */
    public function status(int $uid): string
    {
        $row = $this->db->row(
            "SELECT status FROM {$this->db->prefix}accounts WHERE wp_user_id=%d",
            $uid,
        );
        return $row ? (string) $row["status"] : "none";
    }
    /** Mint a session + token pair without a browser flow; reserved for the Zero runtime (§3.5). */
    public function issueForUser(int $wpUserId, string $clientId): array
    {
        return (new OAuth($this->db, $this))->issueForUser($wpUserId, $clientId);
    }
    public static function isGuest(int $uid): bool
    {
        return in_array("zero_guest", (array) get_userdata($uid)?->roles, true);
    }
    /**
     * Sign in with a verified email address. A guest (role `zero_guest`) holding the current
     * session keeps its user id: the address is attached to it and it becomes a subscriber. An
     * address that already belongs to someone signs into that account; the guest is left as is.
     *
     * The upgrade locks the guest's account and its originating session and rechecks both, so a
     * second upgrade racing this one can't attach its email after the first commits. Every earlier
     * credential of the guest ends: sessions, token families, and any passkey (guests can't enroll
     * one, but nothing a former holder of the guest planted may outlive the upgrade).
     *
     * @param ?array $session the identity session the browser presented, if any
     */
    public function verifiedSignIn(string $email, ?array $session): int
    {
        $email = self::email($email);
        $guest = $session === null ? null : (int) $session["wp_user_id"];
        if ($guest === null || !self::isGuest($guest)) {
            return $this->emailLogin($email);
        }
        return $this->db->transaction(function () use ($email, $guest, $session) {
            if ($this->owner($email) || get_user_by("email", $email)) {
                return $this->emailLogin($email);
            }
            $this->ensure($guest);
            $this->db->lock($guest);
            $live = $this->db->row(
                "SELECT id FROM {$this->db->prefix}sessions WHERE id=%s AND wp_user_id=%d AND revoked_at IS NULL FOR UPDATE",
                $session["id"],
                $guest,
            );
            clean_user_cache($guest);
            if (!$live || !self::isGuest($guest)) {
                // Another upgrade won the race: this browser's guest session is gone.
                throw new Failure("unauthenticated", "This guest session ended. Sign in again.", 401);
            }
            $this->claim($guest, $email, "email_code");
            Plugin::$sessions->revoke($guest);
            $this->db->run("DELETE FROM {$this->db->prefix}passkeys WHERE wp_user_id=%d", $guest);
            $this->db->run("DELETE FROM {$this->db->prefix}mfa WHERE wp_user_id=%d", $guest);
            $this->db->run("DELETE FROM {$this->db->prefix}recovery_codes WHERE wp_user_id=%d", $guest);
            $this->db->run("DELETE FROM {$this->db->prefix}providers WHERE wp_user_id=%d", $guest);
            // Core credentials too: a fresh random password and no application passwords.
            $this->db->run(
                "UPDATE {$this->db->wp->users} SET user_pass=%s, user_activation_key='' WHERE ID=%d",
                wp_hash_password(Security::token(48)),
                $guest,
            );
            $this->db->run(
                "DELETE FROM {$this->db->wp->usermeta} WHERE user_id=%d AND meta_key IN ('_application_passwords','session_tokens')",
                $guest,
            );
            $this->db->touch($guest);
            $user = new \WP_User($guest);
            $user->set_role("subscriber");
            clean_user_cache($guest);
            $this->security->event($guest, "guest.upgraded");
            do_action("zero_identity_guest_upgraded", $guest);
            return $guest;
        });
    }
    public function suspend(int $uid, bool $suspend): void
    {
        $this->ensure($uid);
        $this->db->transaction(function () use ($uid, $suspend) {
            $this->db->run(
                "SELECT wp_user_id FROM {$this->db->prefix}accounts WHERE wp_user_id=%d FOR UPDATE",
                $uid,
            );
            $this->db->run(
                "UPDATE {$this->db->prefix}accounts SET status=%s WHERE wp_user_id=%d",
                $suspend ? "suspended" : "active",
                $uid,
            );
            $this->db->run(
                "UPDATE {$this->db->prefix}sessions SET revoked_at=%d WHERE wp_user_id=%d",
                time(),
                $uid,
            );
            $this->security->event(
                $uid,
                $suspend ? "account.suspended" : "account.restored",
            );
        });
        \WP_Session_Tokens::get_instance($uid)->destroy_all();
    }
}
