<?php
// Execute the generated action with the shipped runtime, without a database or WP.
declare(strict_types=1);
$output = $argv[1];
require $output . '/plugins/typedpress-runtime/tp/bootstrap.php';
$schema = require $output . '/plugins/typedpress-app-npm-compat/tp/app/schema.php';
require $output . '/plugins/typedpress-app-npm-compat/tp/app/functions.php';
$fn = '\\TypedPressApp\\' . $schema['actions']['probe']['handler'];
$result = $fn(new \TypedPress\JsObject(), new \TypedPress\JsObject(['user' => null]));
echo \TypedPress\Js::jsonStringify($result), "\n";
