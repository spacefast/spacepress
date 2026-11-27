<?php
declare(strict_types=1);
// Every PHP file SpacePress's own plugins ship (runtime/, embedded into the compiler) parses. `spacepress build`
// lints only the app plugin it generates: SpacePress's plugins are the same bytes for every build, so they
// are checked once here instead of in every build.
require __DIR__ . '/harness.php';
$root  = realpath( __DIR__ . '/../../runtime' );
$skip  = array( 'node_modules', 'apps', 'upstream-metadata', 'vendor', 'vendor-prefixed' );
$files = new RecursiveIteratorIterator(
	new RecursiveCallbackFilterIterator(
		new RecursiveDirectoryIterator( $root, FilesystemIterator::SKIP_DOTS ),
		static fn ( SplFileInfo $f ) => ! ( $f->isDir() && in_array( $f->getFilename(), $skip, true ) ),
	)
);
$bad   = array();
$count = 0;
foreach ( $files as $file ) {
	if ( $file->getExtension() !== 'php' ) {
		continue;
	}
	++$count;
	exec( escapeshellarg( PHP_BINARY ) . ' -l ' . escapeshellarg( $file->getPathname() ) . ' 2>&1', $out, $code );
	if ( 0 !== $code ) {
		$bad[] = substr( $file->getPathname(), strlen( $root ) + 1 ) . ': ' . implode( ' ', $out );
	}
	$out = array();
}
check( "every runtime PHP file parses ($count files)", array() === $bad && $count > 100, $bad );
finish( 'runtime_lint' );
