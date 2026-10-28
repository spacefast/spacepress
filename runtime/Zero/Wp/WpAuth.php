<?php

declare(strict_types=1);

namespace Zero\Wp;

use Zero\Auth;
use Zero\HttpError;

/**
 * WP identity (§5.1): whoever WordPress authenticated for this request (cookie + nonce, application
 * password). Zero adds no mechanism of its own; it only maps capabilities onto the role ladder.
 */
final class WpAuth implements Auth
{
    public function resolve(array $headers): ?array
    {
        return self::current();
    }

    public static function current(): ?array
    {
        $user = wp_get_current_user();

        return $user->exists() ? self::map($user) : null;
    }

    public function user(int $id): ?array
    {
        $user = get_userdata($id);

        return $user instanceof \WP_User ? self::map($user) : null;
    }

    public function login(string $name, string $password): array
    {
        throw HttpError::notFound('Sign in through WordPress (cookies or application passwords) on this target');
    }

    /** @return array{id: int, name: string, role: string} */
    public static function map(\WP_User $user): array
    {
        $role = match (true) {
            $user->has_cap('manage_options') => 'admin',
            $user->has_cap('edit_others_posts') => 'editor',
            $user->has_cap('publish_posts'), $user->has_cap('edit_posts') => 'author',
            default => 'subscriber',
        };

        return ['id' => (int) $user->ID, 'name' => (string) $user->display_name, 'role' => $role];
    }
}
