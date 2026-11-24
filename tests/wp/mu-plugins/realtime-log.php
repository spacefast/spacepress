<?php
// Test stack only: record every SpacePress change notice (the sp_realtime_changes action) as one JSON
// line in the uploads dir, so suites can read what a host transport would have published.
add_action(
	'sp_realtime_changes',
	static function ( array $notice ): void {
		$file = WP_CONTENT_DIR . '/spacepress-test-realtime.jsonl';
		file_put_contents( $file, json_encode( $notice, JSON_UNESCAPED_SLASHES ) . "\n", FILE_APPEND | LOCK_EX );
		// Apache and WP-CLI share this capture but can run as different users.
		if ( ( fileperms( $file ) & 0777 ) !== 0666 ) {
			@chmod( $file, 0666 );
		}
	}
);
