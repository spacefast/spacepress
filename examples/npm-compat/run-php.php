<?php
// Execute the generated action with the shipped runtime, without a database or WP.
declare(strict_types=1);
$output = $argv[1];
require $output . '/plugins/spacepress-runtime/sp/bootstrap.php';
$schema = require $output . '/plugins/spacepress-app-npm-compat/sp/app/schema.php';
require $output . '/plugins/spacepress-app-npm-compat/sp/app/functions.php';
$fn     = '\\SpacePressApp\\' . $schema['actions']['probe']['handler'];
$result = $fn( new \SpacePress\JsObject(), new \SpacePress\JsObject( array( 'user' => null ) ) );
echo \SpacePress\Js::jsonStringify( $result ), "\n";
