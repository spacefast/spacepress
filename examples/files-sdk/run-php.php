<?php
// Run one generated action with the shipped runtime, without a database or WordPress.
// php run-php.php <build-out> <action> <input-json>
declare(strict_types=1);
[$_, $output, $action, $input] = $argv;
require $output . '/plugins/first-runtime/first/bootstrap.php';
$schema = require $output . '/plugins/first-app-files-sdk-probe/first/app/schema.php';
require $output . '/plugins/first-app-files-sdk-probe/first/app/functions.php';
$fn = '\\FirstApp\\' . $schema['actions'][$action]['handler'];
$result = $fn(new \First\JsObject(json_decode($input, true, flags: JSON_THROW_ON_ERROR)), new \First\JsObject(['user' => null]));
echo \First\Js::jsonStringify($result), "\n";
