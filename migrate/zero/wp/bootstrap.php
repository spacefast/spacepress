<?php

declare(strict_types=1);

foreach ( array( 'DryRun', 'Model', 'Migrate', 'Users', 'Spacefast', 'Module' ) as $class ) {
	require_once __DIR__ . "/$class.php";
}
