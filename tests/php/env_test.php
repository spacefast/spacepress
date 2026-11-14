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
putenv('REDIRECT_HTTP_AUTHORIZATION=Basic redirected');
Env::isolate(['DB_PASSWORD' => 'from-a-variable', 'HTTP_PROXY' => 'http://proxy.internal:3128', 'DB_URL' => 'mysql://app', 'APP_VALUE' => 'kept']);
eq('an isolated host never passes WordPress secrets, but its own variables keep request-like names',
    [Env::get('DB_PASSWORD'), Env::get('db_password'), Env::get('HTTP_PROXY'), Env::get('DB_URL'), Env::get('HTTP_COOKIE'), Env::get('APP_VALUE')],
    [null, null, 'http://proxy.internal:3128', 'mysql://app', null, 'kept']);
(static function (): void {
    $scope = new ReflectionProperty(Env::class, 'variables');
    $scope->setValue(null, null);
})();
eq('standalone lookup never falls back to WordPress secrets or per-request server values',
    [Env::get('DB_PASSWORD'), Env::get('LOGGED_IN_SALT'), Env::get('SECRET_KEY'), Env::get('WP_SECRETS_KEY'), Env::get('HTTP_COOKIE'), Env::get('HTTP_PROXY'), Env::get('PHP_AUTH_PW'), Env::get('REDIRECT_HTTP_AUTHORIZATION'), Env::resolve(['env' => 'DB_PASSWORD']), Env::get('FIRST_ENV_CONSTANT')],
    [null, null, null, null, null, null, null, null, null, 'standalone-constant']);
eq('host secrets are exact names; request values are prefixes',
    [array_map([Env::class, 'hostSecret'], ['db_host', 'DB_URL', 'NONCE_KEY', 'SECRET_SALT', 'wp_secrets_key_previous', 'WEBHOOK_SECRET']),
     array_map([Env::class, 'requestValue'], ['HTTP_X_ANYTHING', 'redirect_url', 'PHP_AUTH_USER', 'REMOTE_USER', 'HTTPS_ONLY', 'FIRST_NOW'])],
    [[true, false, true, true, true, false], [true, true, true, true, false, false]]);

putenv('HTTP_COOKIE');
putenv('HTTP_PROXY');
putenv('PHP_AUTH_PW');
putenv('REDIRECT_HTTP_AUTHORIZATION');
putenv('FIRST_ENV_PROCESS');
finish('env');
