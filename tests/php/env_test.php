<?php

declare(strict_types=1);

require __DIR__ . '/../../runtime/Zero/bootstrap.php';
require __DIR__ . '/harness.php';

use Zero\Env;

define('ZERO_ENV_CONSTANT', 'standalone-constant');
putenv('ZERO_ENV_PROCESS=standalone-process');
eq('standalone env reads process values and WordPress constants',
    [Env::get('ZERO_ENV_PROCESS'), Env::resolve(['env' => 'ZERO_ENV_CONSTANT'])],
    ['standalone-process', 'standalone-constant']);

Env::isolate(['APP_VALUE' => 'space-version', 'ZERO_ENV_PROCESS' => '']);
eq('managed env preserves values and empty overrides without ambient fallback',
    [Env::get('APP_VALUE'), Env::get('ZERO_ENV_PROCESS'), Env::resolve(['env' => 'ZERO_ENV_CONSTANT']), Env::get('MISSING'), Env::resolve('literal')],
    ['space-version', '', null, null, 'literal']);

Env::isolate([]);
eq('an empty managed scope denies all ambient values',
    [Env::get('APP_VALUE'), Env::get('ZERO_ENV_PROCESS'), Env::get('ZERO_ENV_CONSTANT')],
    [null, null, null]);

putenv('ZERO_ENV_PROCESS');
finish('env');
