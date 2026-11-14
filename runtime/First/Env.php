<?php

declare(strict_types=1);

namespace First;

/** Runtime variables, isolated to the host's explicit values for managed apps. */
final class Env
{
    /** @var array<string, string>|null Null retains standalone environment lookup. */
    private static ?array $variables = null;

    /**
     * WordPress's own secrets: its database login, its keys and salts (wp-config.php constants,
     * including the pre-2.7 `SECRET_KEY`/`SECRET_SALT` that `wp_salt()` still reads), and the site
     * key of core's Secrets API (`WP_SECRETS_KEY`, and `WP_SECRETS_KEY_PREVIOUS` during rotation).
     * They are never an app variable on any host. The compiler refuses the same names
     * (`src/compile.rs`, `HOST_SECRETS`); a unit test there keeps the two lists equal.
     */
    public const HOST_SECRETS = [
        'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST',
        'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY',
        'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT',
        'SECRET_KEY', 'SECRET_SALT', 'WP_CACHE_KEY_SALT',
        'WP_SECRETS_KEY', 'WP_SECRETS_KEY_PREVIOUS',
    ];

    /**
     * What the web server API puts in the process environment for each request: headers under
     * FastCGI (`HTTP_COOKIE`, `HTTP_AUTHORIZATION`, `HTTP_PROXY`), Apache's copies of them after a
     * rewrite (`REDIRECT_HTTP_AUTHORIZATION`), and the visitor's basic-auth credentials. They are
     * visitor input, not settings, so the ambient fallback never reads them. An isolated host's
     * own variables may use these names.
     */
    private const REQUEST_PREFIXES = ['HTTP_', 'REDIRECT_', 'PHP_AUTH_'];
    private const REQUEST_NAMES = ['AUTH_TYPE', 'REMOTE_USER'];

    public static function hostSecret(string $name): bool
    {
        return in_array(strtoupper($name), self::HOST_SECRETS, true);
    }

    public static function requestValue(string $name): bool
    {
        $upper = strtoupper($name);
        if (in_array($upper, self::REQUEST_NAMES, true)) {
            return true;
        }
        foreach (self::REQUEST_PREFIXES as $prefix) {
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
        if (self::hostSecret($name)) {
            return null;
        }
        if (self::$variables !== null) {
            return self::$variables[$name] ?? null;
        }
        if (self::requestValue($name)) {
            return null;
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
