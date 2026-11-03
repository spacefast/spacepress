<?php
// Execute the generated action with the shipped runtime, without a database or WP.
declare(strict_types=1);
$output = $argv[1];
require $output . '/plugins/zero-runtime/zero/bootstrap.php';
$schema = require $output . '/plugins/zero-app-npm-compat/zero/app/schema.php';
require $output . '/plugins/zero-app-npm-compat/zero/app/functions.php';
$fn = '\\ZeroApp\\' . $schema['actions']['probe']['handler'];
$result = $fn(new \Zero\JsObject(), new \Zero\JsObject(['user' => null]));
echo \Zero\Js::jsonStringify($result), "\n";
