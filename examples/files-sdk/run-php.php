<?php
// Run one generated action with the shipped runtime, without a database or WordPress.
// php run-php.php <build-out> <action> <input-json>
declare(strict_types=1);
[$_, $output, $action, $input] = $argv;
require $output . '/plugins/spacepress-runtime/sp/bootstrap.php';
$schema = require $output . '/plugins/spacepress-app-files-sdk-probe/sp/app/schema.php';
require $output . '/plugins/spacepress-app-files-sdk-probe/sp/app/functions.php';
$fn     = '\\SpacePressApp\\' . $schema['actions'][ $action ]['handler'];
$result = $fn( new \SpacePress\JsObject( json_decode( $input, true, flags: JSON_THROW_ON_ERROR ) ), new \SpacePress\JsObject( array( 'user' => null ) ) );
echo \SpacePress\Js::jsonStringify( $result ), "\n";
