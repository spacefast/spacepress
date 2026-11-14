<?php

declare(strict_types=1);

require __DIR__ . '/../../runtime/First/bootstrap.php';
require __DIR__ . '/harness.php';

use First\Env;

define('FIRST_ENV_CONSTANT', 'standalone-constant');
putenv('FIRST_ENV_PROCESS=standalone-process');
eq('standalone env reads process values and WordPress constants',
    [Env::get('FIRST_ENV_PROCESS'), Env::resolve(['env' => 'FIRST_ENV_CONSTANT'])],
    ['standalone-process', 'standalone-constant']);

Env::isolate(['APP_VALUE' => 'space-version', 'FIRST_ENV_PROCESS' => '']);
eq('managed env preserves values and empty overrides without ambient fallback',
    [Env::get('APP_VALUE'), Env::get('FIRST_ENV_PROCESS'), Env::resolve(['env' => 'FIRST_ENV_CONSTANT']), Env::get('MISSING'), Env::resolve('literal')],
    ['space-version', '', null, null, 'literal']);

Env::isolate([]);
eq('an empty managed scope denies all ambient values',
    [Env::get('APP_VALUE'), Env::get('FIRST_ENV_PROCESS'), Env::get('FIRST_ENV_CONSTANT')],
    [null, null, null]);

define('DB_PASSWORD', 'box-database-password');
define('LOGGED_IN_SALT', 'box-salt');
define('SECRET_KEY', 'legacy-salt');
define('WP_SECRETS_KEY', 'secrets-api-site-key');
putenv('HTTP_COOKIE=wordpress_logged_in_x=platform-session');
putenv('HTTP_PROXY=http://attacker.example');
putenv('PHP_AUTH_PW=basic-password');
Env::isolate(['DB_PASSWORD' => 'from-a-variable', 'HTTP_PROXY' => 'http://proxy.internal:3128', 'DB_URL' => 'mysql://app', 'APP_VALUE' => 'kept']);
eq('an isolated host never passes WordPress secrets, but its own variables keep request-like names',
    [Env::get('DB_PASSWORD'), Env::get('db_password'), Env::get('HTTP_PROXY'), Env::get('DB_URL'), Env::get('HTTP_COOKIE'), Env::get('APP_VALUE')],
    [null, null, 'http://proxy.internal:3128', 'mysql://app', null, 'kept']);
(static function (): void {
    $scope = new ReflectionProperty(Env::class, 'variables');
    $scope->setValue(null, null);
})();
eq('standalone lookup never falls back to WordPress secrets or per-request server values',
    [Env::get('DB_PASSWORD'), Env::get('LOGGED_IN_SALT'), Env::get('SECRET_KEY'), Env::get('WP_SECRETS_KEY'), Env::get('HTTP_COOKIE'), Env::get('HTTP_PROXY'), Env::get('PHP_AUTH_PW'), Env::resolve(['env' => 'DB_PASSWORD']), Env::get('FIRST_ENV_CONSTANT')],
    [null, null, null, null, null, null, null, null, 'standalone-constant']);
eq('host secrets are exact names; request values are prefixes',
    [array_map([Env::class, 'hostSecret'], ['db_host', 'DB_URL', 'NONCE_KEY', 'SECRET_SALT', 'wp_secrets_key_previous', 'WEBHOOK_SECRET']),
     array_map([Env::class, 'requestValue'], ['HTTP_X_ANYTHING', 'query_string', 'PHP_AUTH_USER', 'REMOTE_USER', 'HTTPS_ONLY', 'FIRST_NOW'])],
    [[true, false, true, true, true, false], [true, true, true, true, false, false]]);
eq('core\'s filesystem and proxy credentials are WordPress secrets too',
    array_map([Env::class, 'hostSecret'], ['FTP_PASS', 'ftp_privkey', 'FTP_USER', 'FTP_PUBKEY', 'WP_PROXY_USERNAME', 'WP_PROXY_PASSWORD', 'WP_PROXY_HOST']),
    [true, true, true, true, true, true, false]);
eq('CGI meta-variables are request values by exact name; an app\'s look-alike names are not',
    array_map([Env::class, 'requestValue'], ['QUERY_STRING', 'REQUEST_URI', 'PATH_INFO', 'CONTENT_TYPE', 'REMOTE_ADDR', 'SCRIPT_FILENAME', 'ORIG_SCRIPT_NAME', 'REDIRECT_STATUS',
        'REDIRECT_URI', 'SERVER_URL', 'URL', 'PATH', 'CONTENT_API_KEY', 'REQUEST_TIMEOUT']),
    [true, true, true, true, true, true, true, true, false, false, false, false, false, false]);
(static function (): void {
    putenv('QUERY_STRING=visitor=1');
    putenv('REDIRECT_URI=https://app.example/process');
    define('FTP_PASS', 'ftp-secret');
    define('WP_PROXY_PASSWORD', 'proxy-secret');
    define('QUERY_STRING', 'from-wp-config');
})();
eq('standalone: a request value never comes from the process environment, but a wp-config constant of that name still reads; core credentials never read',
    [Env::get('QUERY_STRING'), Env::get('REDIRECT_URI'), Env::get('FTP_PASS'), Env::get('WP_PROXY_PASSWORD')],
    ['from-wp-config', 'https://app.example/process', null, null]);
putenv('QUERY_STRING');
putenv('REDIRECT_URI');

putenv('HTTP_COOKIE');
putenv('HTTP_PROXY');
putenv('PHP_AUTH_PW');
putenv('FIRST_ENV_PROCESS');
finish('env');
