<?php

declare(strict_types=1);

require __DIR__ . '/harness.php';
require __DIR__ . '/../../runtime/SpacePress/bootstrap.php';

$vendor_files = static fn (): array => array_values(
	array_filter(
		get_included_files(),
		static fn ( string $file ): bool => str_contains( $file, '/vendor-prefixed/' )
	)
);
eq( 'boot does not load optional dependencies', $vendor_files(), array() );
eq( 'foreign class lookup has no effect', class_exists( 'UnrelatedPlugin\\Absent' ), false );
eq( 'foreign lookup does not initialize the bundled loader', $vendor_files(), array() );
$merge = new \SpacePress\Vendor\WordPress\Merge\MergeStrategy(
	new \SpacePress\Vendor\WordPress\Merge\Diff\LineDiffer(),
	new \SpacePress\Vendor\WordPress\Merge\Merge\LineMerger(),
);
check( 'the first vendor class initializes the bundle', $vendor_files() !== array() );
eq( 'scoped dependencies load through Composer', $merge->merge( "a\nb\n", "A\nb\n", "a\nB\n" )->get_merged_content(), "A\nB\n\n" );
// WordPress core provides these; the bundle must not carry private copies of them.
eq(
	'the bundle defines no WordPress HTML API or block parser',
	array_values(
		array_filter(
			array( 'WP_HTML_Tag_Processor', 'WP_HTML_Processor', 'WP_Block_Parser' ),
			static fn ( string $class ): bool => class_exists( 'SpacePress_Vendor_' . $class )
		)
	),
	array()
);
$s3 = new \SpacePress\Vendor\AsyncAws\S3\S3Client(
	array(
		'region'          => 'us-east-1',
		'accessKeyId'     => 'test',
		'accessKeySecret' => 'test',
	)
);
eq( 'the optional S3 client initializes through the same loader', $s3->getConfiguration()->get( 'region' ), 'us-east-1' );
eq( 'unknown scoped classes are ordinary misses', class_exists( 'SpacePress\\Vendor\\Absent' ), false );
eq( 'unknown global classes are ordinary misses', class_exists( 'SpacePress_Vendor_Absent' ), false );
$files = $vendor_files();
class_exists( 'SpacePress\\Vendor\\AbsentAgain' );
eq( 'misses do not reload vendor function files', $vendor_files(), $files );
finish( 'autoload' );
