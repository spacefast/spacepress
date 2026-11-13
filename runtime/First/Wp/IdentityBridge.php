<?php

declare(strict_types=1);

namespace First\Wp;

use First\Auth\Issuer;
use First\HttpError;

/**
 * Feature 4 on WordPress (§6.2) when first-identity is active: guests are `first_guest` WordPress
 * users signed in through `Accounts::issueForUser` for the auto-registered `app_zero_guest`
 * client; sign-in, refresh and upgrade belong to the issuer at `/identity`. Without first-identity
 * the `/auth` routes answer 404 (WordPress cookies and application passwords still work).
 */
final class IdentityBridge implements Issuer
{
    public const GUEST_CLIENT = 'app_zero_guest';
    private static bool $hooked = false;

    public function __construct(private readonly Connection $db)
    {
    }

    public static function available(): bool
    {
        return Runtime::identity() && did_action('first_runtime_loaded') > 0;
    }

    /** first-identity hooks: shared transactions on $wpdb, the guest role, `wp first identity` suspension. */
    public static function hook(Connection $db): void
    {
        if (self::$hooked) {
            return;
        }
        self::$hooked = true;
        // Identity joins a First transaction on the shared $wpdb by itself; users it changes there
        // must leave the object cache if the First transaction later rolls back.
        add_action('first_identity_touched_user', static function (int $uid) use ($db): void {
            $db->onRollback(static function () use ($uid): void {
                clean_user_cache($uid);
                wp_cache_delete($uid, 'user_meta');
            });
        });
        // On First's API a failed Bearer is answered by WpAuth as a problem document; elsewhere identity's error stands.
        add_filter('first_identity_bearer_error', static fn ($error) => Facade::path() !== null ? null : $error);
    }

    public static function suspended(int $userId): bool
    {
        return self::available() && in_array(\First\Identity\Plugin::$accounts->status($userId), ['suspended', 'deletion_requested', 'deleted'], true);
    }

    /** The `first_guest` role and the guest client exist (idempotent; activation and first use). */
    public static function provision(): void
    {
        if (get_role('first_guest') === null) {
            add_role('first_guest', 'Guest', ['read' => true]);
        }
        if (!self::available()) {
            return;
        }
        $db = \First\Identity\Plugin::$db;
        if (!$db->row("SELECT id FROM {$db->prefix}applications WHERE id=%s", self::GUEST_CLIENT)) {
            $db->insert('applications', ['id' => self::GUEST_CLIENT, 'name' => get_bloginfo('name') ?: 'Guests', 'redirects' => '[]', 'origins' => '[]']);
        }
    }

    public function config(bool $guests): array
    {
        return ['issuer' => untrailingslashit(home_url('/identity')), 'guests' => $guests];
    }

    public function guest(): array
    {
        self::provision();
        $collection = \First\db()->schema()->auth()['collection'] ?? null;
        if ($collection !== null) {
            // Through the pipeline, so the member row gets its defaults like any other create.
            $values = ['email' => 'guest-' . bin2hex(random_bytes(8)) . '@guest.invalid', 'role' => 'guest'];
            if (isset(\First\db()->schema()->collection($collection)['columns']['name'])) {
                $values['name'] = 'Guest ' . substr(bin2hex(random_bytes(4)), 0, 6);
            }
            $id = (int) \First\db()->insert($collection, $values, true)[0]['id'];
        } else {
            $id = $this->db->core(static fn () => wp_insert_user([
                'user_login' => 'zg_' . bin2hex(random_bytes(8)),
                'user_pass' => wp_generate_password(32, true, true),
                'display_name' => 'Guest',
                'role' => 'first_guest',
            ]));
            if ($id instanceof \WP_Error) {
                throw new \RuntimeException('wp_insert_user failed: ' . $id->get_error_message());
            }
            $id = (int) $id;
            $this->db->onRollback(static fn () => clean_user_cache($id));
        }
        $tokens = \First\Identity\Plugin::$accounts->issueForUser($id, self::GUEST_CLIENT);

        return [
            'accessToken' => $tokens['access_token'],
            'refreshToken' => $tokens['refresh_token'],
            'expiresIn' => $tokens['expires_in'],
            'clientId' => self::GUEST_CLIENT,
            'user' => WpAuth::map(new \WP_User($id)),
        ];
    }

    public function signOut(array $user): void
    {
        $token = \First\Identity\Bearer::token() ?? throw new HttpError(401, 'unauthenticated', 'Sign out applies to Bearer sessions; WordPress cookies sign out through wp-login');
        (new \First\Identity\OAuth(\First\Identity\Plugin::$db, \First\Identity\Plugin::$accounts))->endFamily($token['family']);
    }

    public function verifiesEmail(): bool
    {
        return true;
    }
}
