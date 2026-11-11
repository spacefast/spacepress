<?php
// Execute the generated action with the shipped runtime, without a database or WP.
declare(strict_types=1);
$output = $argv[1];
require $output . '/plugins/first-runtime/first/bootstrap.php';
$schema = require $output . '/plugins/first-app-npm-compat/first/app/schema.php';
require $output . '/plugins/first-app-npm-compat/first/app/functions.php';
$fn = '\\FirstApp\\' . $schema['actions']['probe']['handler'];
$result = $fn(new \First\JsObject(), new \First\JsObject(['user' => null]));
echo \First\Js::jsonStringify($result), "\n";
