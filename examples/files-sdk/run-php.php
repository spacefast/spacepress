<?php
// Run one generated action with the shipped runtime, without a database or WordPress.
// php run-php.php <build-out> <action> <input-json>
declare(strict_types=1);
[$_, $output, $action, $input] = $argv;
require $output . '/plugins/typedpress-runtime/tp/bootstrap.php';
$schema = require $output . '/plugins/typedpress-app-files-sdk-probe/tp/app/schema.php';
require $output . '/plugins/typedpress-app-files-sdk-probe/tp/app/functions.php';
$fn = '\\TypedPressApp\\' . $schema['actions'][$action]['handler'];
$result = $fn(new \TypedPress\JsObject(json_decode($input, true, flags: JSON_THROW_ON_ERROR)), new \TypedPress\JsObject(['user' => null]));
echo \TypedPress\Js::jsonStringify($result), "\n";
