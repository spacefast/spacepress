<?php

declare(strict_types=1);

namespace First;

/** Runtime variables, isolated to the host's explicit values for managed apps. */
final class Env
{
    /** @var array<string, string>|null Null retains standalone environment lookup. */
    private static ?array $variables = null;

    /**
     * Host settings app code never reads, isolated or not: WordPress's database credentials and
     * salts (wp-config.php constants), and the request headers and credentials PHP-FPM exposes as
     * environment variables (`HTTP_COOKIE`, `HTTP_AUTHORIZATION`, `PHP_AUTH_PW`). The compiler
     * refuses the same names (`src/compile.rs`, `reserved_env_name`).
     */
    private const RESERVED = [
        'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY',
        'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT', 'WP_CACHE_KEY_SALT',
        'PHP_AUTH_USER', 'PHP_AUTH_PW', 'PHP_AUTH_DIGEST', 'AUTH_TYPE', 'REMOTE_USER',
    ];
    private const RESERVED_PREFIXES = ['DB_', 'HTTP_'];

    public static function reserved(string $name): bool
    {
        $upper = strtoupper($name);
        if (in_array($upper, self::RESERVED, true)) {
            return true;
        }
        foreach (self::RESERVED_PREFIXES as $prefix) {
            if (str_starts_with($upper, $prefix)) {
                return true;
            }
        }

        return false;
    }

    /** Bind a managed app before loading its schema or booting its runtime. */
    public static function isolate(array $variables): void
    {
        self::$variables = [];
        foreach ($variables as $name => $value) {
            if (!is_string($name) || !is_string($value)) {
                throw new \InvalidArgumentException('Runtime variables must map names to strings');
            }
        }
        self::$variables = $variables;
    }

    public static function get(string $name): ?string
    {
        if (self::reserved($name)) {
            return null;
        }
        if (self::$variables !== null) {
            return self::$variables[$name] ?? null;
        }
        $value = getenv($name);
        if ($value !== false) {
            return $value;
        }
        if (defined($name)) {
            $constant = constant($name);

            return is_scalar($constant) ? (string) $constant : null;
        }

        return null;
    }

    /** A schema.php value that is either a literal string or `['env' => NAME]`. */
    public static function resolve(mixed $value): ?string
    {
        if (is_array($value) && isset($value['env'])) {
            return self::get((string) $value['env']);
        }

        return is_string($value) ? $value : null;
    }
}
