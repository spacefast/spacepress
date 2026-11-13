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
putenv('HTTP_COOKIE=wordpress_logged_in_x=platform-session');
putenv('PHP_AUTH_PW=basic-password');
Env::isolate(['DB_PASSWORD' => 'from-a-variable', 'HTTP_COOKIE' => 'from-a-variable', 'APP_VALUE' => 'kept']);
eq('host settings never resolve, even when a managed host passes them as variables',
    [Env::get('DB_PASSWORD'), Env::get('db_password'), Env::get('HTTP_COOKIE'), Env::get('APP_VALUE')],
    [null, null, null, 'kept']);
(static function (): void {
    $scope = new ReflectionProperty(Env::class, 'variables');
    $scope->setValue(null, null);
})();
eq('standalone lookup never falls back to WordPress credentials, salts or FastCGI request values',
    [Env::get('DB_PASSWORD'), Env::get('LOGGED_IN_SALT'), Env::get('HTTP_COOKIE'), Env::get('PHP_AUTH_PW'), Env::resolve(['env' => 'DB_PASSWORD']), Env::get('FIRST_ENV_CONSTANT')],
    [null, null, null, null, null, 'standalone-constant']);
eq('reserved names are the same set the compiler refuses',
    array_map([Env::class, 'reserved'], ['DB_HOST', 'HTTP_X_ANYTHING', 'NONCE_KEY', 'WP_CACHE_KEY_SALT', 'DBX', 'WEBHOOK_SECRET', 'FIRST_NOW']),
    [true, true, true, true, false, false, false]);

putenv('HTTP_COOKIE');
putenv('PHP_AUTH_PW');
putenv('FIRST_ENV_PROCESS');
finish('env');
