<?php

declare(strict_types=1);

use First\Vendor\Rowbot\Idna\Bin\IdnaDataBuilder;
use First\Vendor\Rowbot\Idna\Bin\RegexBuilder;
use First\Vendor\Rowbot\Idna\Bin\ViramaDataBuilder;

const DS = DIRECTORY_SEPARATOR;
const FIRST_VENDOR_ROOT_DIR = __DIR__ . DS . '..';
const FIRST_VENDOR_OUTPUT_DIR = FIRST_VENDOR_ROOT_DIR . DS . 'resources';

require FIRST_VENDOR_ROOT_DIR . DS . 'vendor' . DS . 'autoload.php';

ViramaDataBuilder::buildHashMap(FIRST_VENDOR_OUTPUT_DIR);
RegexBuilder::buildRegexClass(FIRST_VENDOR_OUTPUT_DIR);
IdnaDataBuilder::buildHashMaps(FIRST_VENDOR_OUTPUT_DIR);
