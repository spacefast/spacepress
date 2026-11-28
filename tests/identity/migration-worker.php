<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use SpacePress\Identity\{DB, Schema};

$prefix     = trim( fgets( STDIN ) );
$connection = new wpdb( DB_USER, DB_PASSWORD, DB_NAME, DB_HOST );
$connection->set_prefix( $prefix );
echo $connection->get_var( 'SELECT CONNECTION_ID()' ) . "\n";
fflush( STDOUT );
Schema::migrate( new DB( $connection ) );
if ( '' !== $connection->last_error ) {
	throw new RuntimeException( $connection->last_error );
}
echo "MIGRATED\n";
