<?php
// Run one generated action with the shipped runtime, without a database or WordPress.
// php run-php.php <build-out> <action> <input-json>
declare(strict_types=1);
[$_, $output, $action, $input] = $argv;
require $output . '/plugins/zero-runtime/zero/bootstrap.php';
$schema = require $output . '/plugins/zero-app-files-sdk-probe/zero/app/schema.php';
require $output . '/plugins/zero-app-files-sdk-probe/zero/app/functions.php';
$fn = '\\ZeroApp\\' . $schema['actions'][$action]['handler'];
$result = $fn(new \Zero\JsObject(json_decode($input, true, flags: JSON_THROW_ON_ERROR)), new \Zero\JsObject(['user' => null]));
echo \Zero\Js::jsonStringify($result), "\n";
