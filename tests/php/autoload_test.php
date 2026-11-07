<?php

declare(strict_types=1);

require __DIR__ . '/harness.php';
require __DIR__ . '/../../runtime/Zero/bootstrap.php';

$vendorFiles = static fn (): array => array_values(array_filter(get_included_files(),
    static fn (string $file): bool => str_contains($file, '/vendor-prefixed/')));
eq('boot does not load optional dependencies', $vendorFiles(), []);
eq('foreign class lookup has no effect', class_exists('UnrelatedPlugin\\Absent'), false);
eq('foreign lookup does not initialize the bundled loader', $vendorFiles(), []);
eq('prefixed global class loads through Composer', (new Zero_Vendor_WP_Block_Parser())->parse('hello')[0]['innerHTML'], 'hello');
check('the first vendor class initializes the bundle', $vendorFiles() !== []);
$merge = new \Zero\Vendor\WordPress\Merge\MergeStrategy(
    new \Zero\Vendor\WordPress\Merge\Diff\LineDiffer(),
    new \Zero\Vendor\WordPress\Merge\Merge\LineMerger(),
);
eq('namespaced dependencies work after a global class load', $merge->merge("a\nb\n", "A\nb\n", "a\nB\n")->get_merged_content(), "A\nB\n\n");
$s3 = new \Zero\Vendor\AsyncAws\S3\S3Client(['region' => 'us-east-1', 'accessKeyId' => 'test', 'accessKeySecret' => 'test']);
eq('the optional S3 client initializes through the same loader', $s3->getConfiguration()->get('region'), 'us-east-1');
eq('unknown scoped classes are ordinary misses', class_exists('Zero\\Vendor\\Absent'), false);
eq('unknown global classes are ordinary misses', class_exists('Zero_Vendor_Absent'), false);
$files = $vendorFiles();
class_exists('Zero\\Vendor\\AbsentAgain');
eq('misses do not reload vendor function files', $vendorFiles(), $files);
finish('autoload');
