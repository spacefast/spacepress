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
     * including the pre-2.7 `SECRET_KEY`/`SECRET_SALT` that `wp_salt()` still reads), the site
     * key of core's Secrets API (`WP_SECRETS_KEY`, and `WP_SECRETS_KEY_PREVIOUS` during rotation),
     * and the credentials core reads for its filesystem (`FTP_*`) and outgoing proxy
     * (`WP_PROXY_USERNAME`/`WP_PROXY_PASSWORD`).
     * They are never an app variable on any host. The compiler refuses the same names
     * (`src/compile.rs`, `HOST_SECRETS`); a unit test there keeps the two lists equal.
     */
    public const HOST_SECRETS = [
        'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST',
        'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY',
        'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT',
        'SECRET_KEY', 'SECRET_SALT', 'WP_CACHE_KEY_SALT',
        'WP_SECRETS_KEY', 'WP_SECRETS_KEY_PREVIOUS',
        'FTP_USER', 'FTP_PASS', 'FTP_PUBKEY', 'FTP_PRIVKEY', 'WP_PROXY_USERNAME', 'WP_PROXY_PASSWORD',
    ];

    /**
     * What the web server API puts in the process environment for each request (FastCGI
     * parameters, which `getenv()` returns under php-fpm and CGI): headers (`HTTP_COOKIE`,
     * `HTTP_AUTHORIZATION`, `HTTP_PROXY`), Apache's copies of them after a rewrite
     * (`REDIRECT_HTTP_AUTHORIZATION`, `REDIRECT_QUERY_STRING`, `REDIRECT_URL`), the CGI
     * meta-variables (`QUERY_STRING`, `REQUEST_URI`, `PATH_INFO`, `CONTENT_TYPE`, `REMOTE_ADDR` …),
     * and the visitor's basic-auth credentials. They are exact names, so an app's own
     * `SERVER_URL` or `REDIRECT_URI` isn't one. They are visitor input, not settings, so the process
     * environment fallback never returns them. A wp-config.php constant can't come from a request,
     * so the constant fallback still reads these names (an app's own `REDIRECT_URI` keeps working
     * there), and an isolated host's own variables may use them too.
     */
    private const REQUEST_PREFIXES = ['HTTP_', 'PHP_AUTH_'];
    /** CGI/1.1 meta-variables (RFC 3875 §4.1) and the ones Apache, nginx and php-fpm add. */
    private const REQUEST_NAMES = [
        'AUTH_TYPE', 'CONTENT_LENGTH', 'CONTENT_TYPE', 'GATEWAY_INTERFACE', 'PATH_INFO',
        'PATH_TRANSLATED', 'QUERY_STRING', 'REMOTE_ADDR', 'REMOTE_HOST', 'REMOTE_IDENT',
        'REMOTE_PORT', 'REMOTE_USER', 'REQUEST_METHOD', 'REQUEST_SCHEME', 'REQUEST_URI',
        'REQUEST_TIME', 'REQUEST_TIME_FLOAT', 'SCRIPT_NAME', 'SCRIPT_FILENAME', 'SCRIPT_URI',
        'SCRIPT_URL', 'SERVER_ADDR', 'SERVER_NAME', 'SERVER_PORT', 'SERVER_PROTOCOL',
        'SERVER_SOFTWARE', 'SERVER_ADMIN', 'SERVER_SIGNATURE', 'DOCUMENT_ROOT', 'DOCUMENT_URI',
        'CONTEXT_PREFIX', 'CONTEXT_DOCUMENT_ROOT', 'HTTPS', 'ORIG_PATH_INFO', 'UNIQUE_ID',
        'FCGI_ROLE',
    ];

    public static function hostSecret(string $name): bool
    {
        return in_array(strtoupper($name), self::HOST_SECRETS, true);
    }

    public static function requestValue(string $name): bool
    {
        $upper = strtoupper($name);
        // Apache's copy of a request value after an internal redirect, at any depth
        // (`REDIRECT_HTTP_AUTHORIZATION`, `REDIRECT_REDIRECT_QUERY_STRING`), plus the two it adds of
        // its own (`REDIRECT_URL`, `REDIRECT_STATUS`). An app's `REDIRECT_URI` is none of these.
        $redirected = false;
        while (str_starts_with($upper, 'REDIRECT_')) {
            $upper = substr($upper, 9);
            $redirected = true;
        }
        if ($redirected && in_array($upper, ['URL', 'STATUS'], true)) {
            return true;
        }
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
        $value = self::requestValue($name) ? false : getenv($name);
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
