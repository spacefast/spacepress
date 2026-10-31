<?php

declare(strict_types=1);

namespace Zero\Wp;

use Zero\Auth;
use Zero\HttpError;

/**
 * WP identity (§5.1, §6.2): whoever WordPress authenticated for this request: cookie + nonce,
 * application password, or a zero-identity Bearer access token (resolved by zero-identity's
 * `determine_current_user` filter, after core's). Zero maps capabilities onto the role ladder,
 * `zero_guest` onto `guest`, and refuses suspended accounts on every channel.
 */
final class WpAuth implements Auth
{
    public function resolve(array $headers): ?array
    {
        $user = self::current(); // runs determine_current_user, so a Bearer failure is known below
        if (IdentityBridge::available()) {
            // A Bearer token was presented but didn't resolve: an error, not an anonymous request.
            match (\Zero\Identity\Bearer::failure()) {
                'suspended' => throw new HttpError(403, 'suspended', 'This account is suspended'),
                'invalid_token' => throw new HttpError(401, 'unauthenticated', 'The access token is invalid, expired or revoked'),
                default => null,
            };
        }

        return $user;
    }

    /**
     * The WordPress user of this request, for every Zero channel (REST, abilities, MCP, editor
     * hooks). A suspended account is refused here, so no channel can act for it.
     */
    public static function current(): ?array
    {
        $user = wp_get_current_user();
        if (!$user->exists()) {
            return null;
        }
        if (IdentityBridge::suspended((int) $user->ID)) {
            throw new HttpError(403, 'suspended', 'This account is suspended');
        }

        return self::map($user);
    }

    public function user(int $id): ?array
    {
        $user = get_userdata($id);

        return $user instanceof \WP_User ? self::map($user) : null;
    }

    /** @return array{id: int, name: string, role: string} */
    public static function map(\WP_User $user): array
    {
        $role = match (true) {
            $user->has_cap('manage_options') => 'admin',
            $user->has_cap('edit_others_posts') => 'editor',
            $user->has_cap('publish_posts'), $user->has_cap('edit_posts') => 'author',
            in_array('zero_guest', (array) $user->roles, true) => 'guest',
            default => 'subscriber',
        };

        return ['id' => \Zero\Js::n((int) $user->ID), 'name' => (string) $user->display_name, 'role' => $role];
    }
}
