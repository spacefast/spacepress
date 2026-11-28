<?php
// Shared by the existing native-password/MariaDB and auth/SQLite suites.
declare(strict_types=1);

( static function (): void {
	$db       = \SpacePress\Identity\Plugin::$db;
	$accounts = \SpacePress\Identity\Plugin::$accounts;
	$assert   = static function ( bool $ok, string $label ): void {
		if ( ! $ok ) {
			throw new RuntimeException( $label );
		}
	};
	// Exercise an upgrade inventory on real users without password hashing per fixture row.
	$inventory   = 'sp_identity_password_inventory';
	$fixtureTag  = 'inventory-' . bin2hex( random_bytes( 6 ) ) . '-';
	$fixtureHash = get_option( 'sp_identity_dummy_password_hash' );
	for ( $batch = 0; $batch < 25; $batch++ ) {
		$values = array();
		for ( $i = 0; $i < 100; $i++ ) {
			$values[] = $db->wp->prepare( '(%s,%s)', $fixtureTag . ( $batch * 100 + $i ), $fixtureHash );
		}
		$db->run( "INSERT INTO {$db->wp->users} (user_login,user_pass) VALUES " . implode( ',', $values ) );
	}
	delete_option( $inventory );
	delete_option( 'sp_identity_password_profiles' );
	\SpacePress\Identity\Accounts::rememberPasswordHash( $fixtureHash );
	$registered = get_option( 'sp_identity_password_profiles' );
	$assert( is_array( $registered ) && count( $registered ) === 1 && is_string( array_values( $registered )[0] ), 'legacy registration initializes the profile map before request provisioning' );
	delete_option( 'sp_identity_password_profiles' );
	$interleaved             = false;
	$inventoryInterleaved    = false;
	$registerDuringProvision = static function ( $sql ) use ( &$interleaved, &$inventoryInterleaved, $inventory ) {
		if ( ! $interleaved && preg_match( '/^INSERT /i', $sql ) && str_contains( $sql, "'sp_identity_password_profiles'" ) ) {
			$interleaved = true;
			\SpacePress\Identity\Accounts::rememberPasswordHash( md5( 'disposable-imported-password' ) );
		}
		if ( ! $inventoryInterleaved && preg_match( '/^INSERT /i', $sql ) && str_contains( $sql, "'$inventory'" ) ) {
			$inventoryInterleaved = true;
			update_option(
				$inventory,
				array(
					'after'    => 123,
					'complete' => false,
				),
				false
			);
		}
		return $sql;
	};
	add_filter( 'query', $registerDuringProvision );
	try {
		\SpacePress\Identity\Accounts::provisionPasswordHash();
	} finally {
		remove_filter( 'query', $registerDuringProvision );
	}
	$assert( $interleaved && isset( get_option( 'sp_identity_password_profiles' )['md5'] ), 'provisioning preserves a profile registered between the option existence check and insert' );
	$assert( $inventoryInterleaved && 123 === get_option( $inventory )['after'], 'provisioning preserves concurrently committed inventory progress' );
	update_option(
		$inventory,
		array(
			'after'    => 0,
			'complete' => false,
		),
		false
	);
	$inventoryReads   = 0;
	$observeInventory = static function ( $sql ) use ( &$inventoryReads, $db ) {
		if ( preg_match( '/^SELECT .*user_pass.*FROM ' . preg_quote( $db->wp->users, '/' ) . '/i', $sql ) ) {
			$inventoryReads++;
		}
		return $sql;
	};
	add_filter( 'query', $observeInventory );
	\SpacePress\Identity\Accounts::provisionPasswordHash();
	remove_filter( 'query', $observeInventory );
	$assert( 0 === $inventoryReads, 'ordinary requests never inventory WordPress password hashes' );
	$peak = 0;
	$page = static function () use ( &$peak ): void {
		memory_reset_peak_usage();
		$start = memory_get_usage();
		do_action( 'sp_identity_password_inventory' );
		$peak = max( $peak, memory_get_peak_usage() - $start );
	};
	$page();
	$first = get_option( $inventory );
	$assert( is_array( $first ) && $first['after'] > 0 && ! $first['complete'], 'first bounded page persists a resumable cursor' );
	$crash = static function ( $sql ) {
		if ( strtoupper( trim( $sql ) ) === 'COMMIT' ) {
			throw new RuntimeException( 'simulated inventory crash' );
		}
		return $sql;
	};
	add_filter( 'query', $crash );
	try {
		$page();
		throw new RuntimeException( 'Inventory crash was not injected' );
	} catch ( RuntimeException $e ) {
		$assert( $e->getMessage() === 'simulated inventory crash', 'inventory interruption reached the page commit' );
	} finally {
		remove_filter( 'query', $crash );
	}
	$assert( get_option( $inventory ) === $first, 'interrupted page preserves the last committed cursor' );
	$page();
	$assert( get_option( $inventory )['after'] > $first['after'], 'next worker resumes beyond the committed page' );
	for ( $attempt = 0; $attempt < 100 && ! get_option( $inventory )['complete']; $attempt++ ) {
		$page();
	}
	$assert( get_option( $inventory )['complete'], 'multi-page inventory eventually completes' );
	$assert( $peak < 2 * 1024 * 1024, 'inventory holds less than 2 MiB of transient memory with 2500 users' );
	$db->run( "DELETE FROM {$db->wp->users} WHERE user_login LIKE %s", $db->wp->esc_like( $fixtureTag ) . '%' );
	echo "PASS password inventory: 2500 users, resumable crash, peak transient bytes=$peak\n";
	$_SERVER['REMOTE_ADDR']    ??= '127.0.0.1';
	$_SERVER['REQUEST_METHOD'] ??= 'GET';
	$tag                         = bin2hex( random_bytes( 6 ) );
	$password                    = 'disposable-storage-test-password';
	$uid                         = wp_create_user( 'storage-' . $tag, $password );
	$assert( is_int( $uid ), 'WordPress user created' );
	$assert( $accounts->status( $uid ) === 'none', 'successful missing identity read stays distinct' );
	$assert( wp_authenticate( 'storage-' . $tag, $password ) instanceof WP_User, 'native user without identity works' );
	$_COOKIE[ LOGGED_IN_COOKIE ] = wp_generate_auth_cookie( $uid, time() + 3600, 'logged_in' );
	$assert( (int) apply_filters( 'determine_current_user', false ) === $uid, 'cookie user without identity works' );
	add_filter( 'wp_is_application_passwords_available', '__return_true' );
	add_filter( 'application_password_is_api_request', '__return_true' );
	[$appPassword]     = WP_Application_Passwords::create_new_application_password( $uid, array( 'name' => 'storage' ) );
	$appLogin          = static fn () => wp_authenticate_application_password( null, 'storage-' . $tag, $appPassword );
	$assert( $appLogin() instanceof WP_User, 'application password without identity works' );
	$completeInventory = get_option( $inventory );
	update_option(
		$inventory,
		array(
			'after'    => 0,
			'complete' => false,
		),
		false
	);
	$fallbackChecks  = array();
	$observeFallback = static function ( $valid, $plain, $hash, $id ) use ( &$fallbackChecks ) {
		$fallbackChecks[] = array( $hash, $id );
		return $valid;
	};
	add_filter( 'check_password', $observeFallback, 10, 4 );
	try {
		$assert( $accounts->password( 'storage-' . $tag, $password ) === $uid, 'correct login works before inventory completes' );
		try {
			$accounts->password( 'absent-' . $tag, 'incorrect-password' );
			throw new RuntimeException( 'Missing account accepted during inventory' );
		} catch ( \SpacePress\Identity\Failure $e ) {
			$assert( 'invalid_credentials' === $e->kind, 'incomplete inventory keeps generic refusal' );
		}
	} finally {
		remove_filter( 'check_password', $observeFallback );
		update_option( $inventory, $completeInventory, false );
	}
	$fixedDummy = get_option( 'sp_identity_dummy_password_hash' );
	$assert( $fallbackChecks === array( array( $fixedDummy, 0 ), array( get_userdata( $uid )->user_pass, $uid ), array( $fixedDummy, 0 ), array( $fixedDummy, 0 ) ), 'incomplete inventory always verifies the current dummy plus own hash or dummy' );
	$verified = array();
	$observe  = static function ( $valid, $plain, $hash, $userId ) use ( &$verified ) {
		$verified[] = array( $hash, $userId );
		return $valid;
	};
	add_filter( 'check_password', $observe, 10, 4 );
	try {
		foreach ( array( 'storage-' . $tag, 'absent-' . $tag, 'absent-' . $tag ) as $login ) {
			try {
				$accounts->password( $login, 'incorrect-password' );
				throw new RuntimeException( 'Wrong password accepted' );
			} catch ( \SpacePress\Identity\Failure $e ) {
				$assert( 'invalid_credentials' === $e->kind && $e->getMessage() === 'The sign-in details are incorrect.', 'generic sign-in refusal' );
			}
		}
	} finally {
		remove_filter( 'check_password', $observe );
	}
	$profileCount = count( get_option( 'sp_identity_password_profiles' ) );
	$assert( count( $verified ) === 3 * $profileCount, 'each attempt verifies every stored password profile' );
	[$knownChecks, $absentChecks, $repeatChecks] = array_chunk( $verified, $profileCount );
	$actualChecks                                = array_values( array_filter( $knownChecks, static fn ( $check ) => (int) $check[1] === $uid ) );
	$assert( count( $actualChecks ) === 1 && $actualChecks[0][0] === get_userdata( $uid )->user_pass, 'known user is verified by ID within its schedule' );
	$assert( $absentChecks === $repeatChecks && array_unique( array_column( $absentChecks, 1 ) ) === array( 0 ), 'absent accounts repeat the fixed dummy schedule' );
	$currentDummy  = get_option( 'sp_identity_dummy_password_hash' );
	$currentChecks = array_filter( $absentChecks, static fn ( $check ) => ! wp_password_needs_rehash( $check[0] ) );
	$assert( count( $currentChecks ) >= 1 && ! wp_password_needs_rehash( $currentDummy ), 'absent schedule includes a fixed current-algorithm hash' );
	require_once ABSPATH . WPINC . '/class-phpass.php';
	$legacyPassword = 'legacy profile password';
	// Use WordPress's real default algorithm/options, without the harness's cheap-cost filter.
	$hashOptions = $GLOBALS['wp_filter']['wp_hash_password_options'] ?? null;
	unset( $GLOBALS['wp_filter']['wp_hash_password_options'] );
	try {
		$wordpressHash = wp_hash_password( $legacyPassword );
	} finally {
		if ( null !== $hashOptions ) {
			$GLOBALS['wp_filter']['wp_hash_password_options'] = $hashOptions;
		}
	}
	$assert( str_starts_with( $wordpressHash, '$wp$2y$' ) && wp_check_password( $legacyPassword, $wordpressHash ), 'WordPress 7.1 produces a supported SHA-384-prefixed bcrypt credential at its default cost' );
	$legacyUsers  = array();
	$legacyHashes = array(
		md5( $legacyPassword ),
		( new PasswordHash( 8, true ) )->HashPassword( $legacyPassword ),
		password_hash( $legacyPassword, PASSWORD_BCRYPT, array( 'cost' => 4 ) ),
		crypt( $legacyPassword, '$1$saltsalt$' ),
		crypt( $legacyPassword, '$5$rounds=5000$saltsaltsalt$' ),
		crypt( $legacyPassword, '$6$rounds=5000$saltsaltsalt$' ),
		$wordpressHash,
	);
	if ( in_array( 'argon2id', password_algos(), true ) ) {
		$validArgon     = password_hash(
			$legacyPassword,
			'argon2id',
			array(
				'memory_cost' => 8192,
				'time_cost'   => 1,
				'threads'     => 1,
			)
		);
		$legacyHashes[] = $validArgon;
	}
	foreach ( $legacyHashes as $i => $hash ) {
		$legacyId = wp_create_user( 'legacy-' . $i . '-' . $tag, $legacyPassword );
		$old      = get_userdata( $legacyId );
		$db->wp->update( $db->wp->users, array( 'user_pass' => $hash ), array( 'ID' => $legacyId ) );
		clean_user_cache( $legacyId );
		if ( 2 === $i ) {
			// A raw legacy import has no WordPress password-write hook (#118).
			$assert( is_callable( array( \SpacePress\Identity\Accounts::class, 'rememberPasswordHash' ) ), 'legacy importer can detect the password-profile capability' );
			\SpacePress\Identity\Accounts::rememberPasswordHash( $hash );
		} else {
			do_action( 'profile_update', $legacyId, $old );
		}
		$legacyUsers[] = $legacyId;
	}
	$unsupportedUsers  = array();
	$unsupportedHashes = array(
		str_repeat( '!', 60 ),
		'$2y$99$' . str_repeat( 'a', 53 ),
		'$wp$2y$12$' . str_repeat( '!', 53 ),
		'$2y$99$' . str_repeat( '!', 53 ),
		'$argon2id$v=19$m=1,t=2,p=1$' . str_repeat( '!', 43 ),
		'$argon2id$v=19$m=8192,t=1,p=1$' . str_repeat( 'A', 22 ) . '$' . str_repeat( '!', 43 ),
		'$5$rounds=0005000$saltsaltsalt$' . str_repeat( 'a', 43 ),
		'$6$rounds=0005000$saltsaltsalt$' . str_repeat( 'a', 86 ),
		'$1$bad!salt$' . str_repeat( 'a', 22 ),
	);
	if ( isset( $validArgon ) ) {
		foreach ( array(
			'm=8192' => 'm=08192',
			't=1'    => 't=01',
			'p=1'    => 'p=01',
		) as $canonical => $malformed ) {
			$unsupportedHashes[] = str_replace( $canonical, $malformed, $validArgon );
		}
	}
	foreach ( $unsupportedHashes as $i => $hash ) {
		$invalidId = wp_create_user( 'disabled-' . $i . '-' . $tag, $legacyPassword );
		$old       = get_userdata( $invalidId );
		$db->wp->update( $db->wp->users, array( 'user_pass' => $hash ), array( 'ID' => $invalidId ) );
		clean_user_cache( $invalidId );
		do_action( 'profile_update', $invalidId, $old );
		$unsupportedUsers[] = $invalidId;
	}
	$schedules = array();
	foreach ( array_merge( array( $uid ), $legacyUsers, $unsupportedUsers, array( 0 ) ) as $candidate ) {
		$profileChecks   = array();
		$observeProfiles = static function ( $valid, $plain, $hash ) use ( &$profileChecks ) {
			$wp              = str_starts_with( $hash, '$wp' );
			$info            = password_get_info( $wp ? substr( $hash, 3 ) : $hash );
			$profileChecks[] = strlen( $hash ) <= 32 ? 'md5' : ( str_starts_with( $hash, '$P$' ) ? substr( $hash, 0, 4 ) : json_encode( array( $wp, $info['algoName'], $info['options'] ) ) );
			return $valid;
		};
		add_filter( 'check_password', $observeProfiles, 10, 3 );
		try {
			$accounts->password( $candidate ? get_userdata( $candidate )->user_login : 'absent-profile-' . $tag, 'incorrect-password' );
			throw new RuntimeException( 'Wrong profile password accepted' );
		} catch ( \SpacePress\Identity\Failure $e ) {
			$assert( 'invalid_credentials' === $e->kind, 'every password profile has the same generic refusal' );
		} finally {
			remove_filter( 'check_password', $observeProfiles );
		}
		sort( $profileChecks );
		$schedules[] = $profileChecks;
	}
	$assert( count( $schedules[0] ) >= 7 && array_filter( $schedules, static fn ( $checks ) => $checks !== $schedules[0] ) === array(), 'known, absent, MD5, phpass, cheaper bcrypt, imported crypt and disabled accounts perform the same verification work' );
	foreach ( $unsupportedUsers as $invalidId ) {
		$acceptPluggable = static fn ( $valid, $plain, $hash, $id ) => $id === $invalidId ? true : $valid;
		add_filter( 'check_password', $acceptPluggable, 10, 4 );
		try {
			$accounts->password( get_userdata( $invalidId )->user_login, $legacyPassword );
			throw new RuntimeException( 'Unsupported password format accepted' );
		} catch ( \SpacePress\Identity\Failure $e ) {
			$assert( 'invalid_credentials' === $e->kind, 'unsupported password formats fail closed without custom verification work' );
		} finally {
			remove_filter( 'check_password', $acceptPluggable );
		}
	}
	foreach ( $legacyUsers as $legacyId ) {
		$assert( $accounts->password( get_userdata( $legacyId )->user_login, $legacyPassword ) === $legacyId, 'legacy WordPress passwords still authenticate' );
	}
	// Observe real WordPress verification without ever executing hostile cost parameters.
	$overBudget = array(
		str_replace( '$2y$04$', '$2y$16$', $legacyHashes[2] ),
		str_replace( '$2y$04$', '$2y$31$', $legacyHashes[2] ),
		substr_replace( $wordpressHash, '16', 7, 2 ),
		substr_replace( $legacyHashes[1], 'F', 3, 1 ), // phpass exponent 17.
		substr_replace( $legacyHashes[1], 'S', 3, 1 ), // phpass exponent 30.
		str_replace( 'rounds=5000', 'rounds=1000001', $legacyHashes[4] ),
		str_replace( 'rounds=5000', 'rounds=999999999', $legacyHashes[5] ),
	);
	if ( isset( $validArgon ) ) {
		foreach ( array(
			'm=8192' => array( 'm=131073', 'm=4294967295' ),
			't=1'    => array( 't=9', 't=4294967295' ),
			'p=1'    => array( 'p=3' ),
		) as $parameter => $values ) {
			foreach ( $values as $value ) {
				$overBudget[] = str_replace( $parameter, $value, $validArgon );
			}
		}
	}
	$verifier             = new class($overBudget) {
		public array $hashes = array();
		public function __construct( private array $forbidden ) {}
		public function CheckPassword( $plain, $hash ): bool {
			if ( in_array( $hash, $this->forbidden, true ) ) {
				throw new RuntimeException( 'Over-budget hash reached the WordPress verifier' );
			}
			$this->hashes[] = $hash;
			global $wp_hasher;
			$saved     = $wp_hasher;
			$wp_hasher = null;
			try {
				return wp_check_password( $plain, $hash );
			} finally {
				$wp_hasher = $saved;
			}
		}
	};
	$profilesBeforeBudget = get_option( 'sp_identity_password_profiles' );
	$stateBeforeBudget    = get_option( $inventory );
	$savedHasher          = $GLOBALS['wp_hasher'] ?? null;
	$GLOBALS['wp_hasher'] = $verifier;
	$refuse               = static function ( string $login ) use ( $accounts, $assert, $verifier ): array {
		$verifier->hashes = array();
		try {
			$accounts->password( $login, 'incorrect-password' );
			throw new RuntimeException( 'Over-budget or absent account authenticated' );
		} catch ( \SpacePress\Identity\Failure $e ) {
			$assert( 'invalid_credentials' === $e->kind, 'over-budget accounts retain the generic refusal' );
		}
		return $verifier->hashes;
	};
	try {
		$baselineWork  = $refuse( 'absent-budget-' . $tag );
		$staleProfiles = $profilesBeforeBudget;
		foreach ( $overBudget as $i => $hash ) {
			$staleProfiles[ 'previously-imported-' . $i ] = $hash;
		}
		update_option( 'sp_identity_password_profiles', $staleProfiles, false );
		$assert( $refuse( 'absent-budget-' . $tag ) === $baselineWork, 'previously stored extreme profiles add no verification work for absent accounts' );
		update_option( 'sp_identity_password_profiles', $profilesBeforeBudget, false );
		$extremeId = $unsupportedUsers[0];
		foreach ( $overBudget as $hash ) {
			\SpacePress\Identity\Accounts::rememberPasswordHash( $hash );
			$assert( get_option( 'sp_identity_password_profiles' ) === $profilesBeforeBudget, 'extreme imports create no verification profile' );
			$db->wp->update( $db->wp->users, array( 'user_pass' => $hash ), array( 'ID' => $extremeId ) );
			clean_user_cache( $extremeId );
			$assert( $refuse( get_userdata( $extremeId )->user_login ) === $baselineWork, 'extreme imports are refused with the same bounded schedule as absent accounts' );
			update_option(
				$inventory,
				array(
					'after'    => 0,
					'complete' => false,
				),
				false
			);
			$fallbackWork = $refuse( 'absent-budget-' . $tag );
			$assert( $refuse( get_userdata( $extremeId )->user_login ) === $fallbackWork, 'incomplete inventory never verifies an over-budget credential' );
			\SpacePress\Identity\Accounts::inventoryPasswordHashes();
			$assert( get_option( 'sp_identity_password_profiles' ) === $profilesBeforeBudget, 'background inventory never derives an extreme profile' );
			update_option( $inventory, $stateBeforeBudget, false );
		}
		$assert( $accounts->password( 'storage-' . $tag, $password ) === $uid, 'extreme imports leave supported sign-in working' );
	} finally {
		$GLOBALS['wp_hasher'] = $savedHasher;
		update_option( 'sp_identity_password_profiles', $profilesBeforeBudget, false );
		update_option( $inventory, $stateBeforeBudget, false );
	}
	echo "PASS imported costs are bounded; default WordPress \$wp\$2y\$, phpass and MD5 authenticate\n";
	wp_set_password( 'replacement legacy password', $legacyUsers[0] );
	require_once ABSPATH . 'wp-admin/includes/user.php';
	wp_delete_user( $legacyUsers[0] );
	foreach ( get_option( 'sp_identity_password_profiles' ) as $dummy ) {
		$assert( ! wp_check_password( $legacyPassword, $dummy ), 'retained verification profiles cannot verify credentials after password replacement and user deletion' );
	}
	$accounts->ensure( $uid );
	$client = 'storage_' . $tag;
	$db->insert(
		'applications',
		array(
			'id'        => $client,
			'name'      => 'Storage test',
			'redirects' => '[]',
			'origins'   => '[]',
		)
	);
	if ( ! did_action( 'sp_runtime_loaded' ) ) {
		do_action( 'sp_runtime_loaded' );
	}
	$tokens = $accounts->issueForUser( $uid, $client );
	$assert( ( new \SpacePress\Identity\OAuth( $db, $accounts ) )->access( $tokens['access_token'] )['uid'] === $uid, 'OAuth token works before suspension' );
	// Retain credentials: suspension status itself must refuse, even without revocation help.
	$db->run( "UPDATE {$db->prefix}accounts SET status='suspended' WHERE wp_user_id=%d", $uid );
	$assert( is_wp_error( wp_authenticate( 'storage-' . $tag, $password ) ), 'suspended native login refused' );
	$assert( is_wp_error( $appLogin() ), 'suspended application password refused' );
	$assert( 0 === (int) apply_filters( 'determine_current_user', false ), 'suspended cookie refused' );
	$table    = $db->prefix . 'accounts';
	$raw      = defined( 'DB_PATH' ) ? new PDO( 'sqlite:' . DB_PATH ) : null;
	$ddl      = static fn ( string $sql ) => null !== $raw ? $raw->exec( $sql ) : $db->wp->query( $sql );
	$suppress = $db->wp->suppress_errors( true );
	$assert( $ddl( "ALTER TABLE $table RENAME TO {$table}_unavailable" ) !== false, 'accounts table made unreadable' );
	try {
		foreach ( array( 'row', 'rows' ) as $method ) {
			try {
				$db->$method( "SELECT * FROM $table" );
				throw new RuntimeException( 'Failed read became an absent row' );
			} catch ( \SpacePress\Identity\Failure $e ) {
				$assert( 'storage_unavailable' === $e->kind && 503 === $e->status && ! str_contains( $e->getMessage(), $table ), 'sanitized storage refusal' );
			}
		}
		$native = wp_authenticate( 'storage-' . $tag, $password );
		$assert( is_wp_error( $native ) && $native->get_error_code() === 'storage_unavailable', 'native password refuses storage failure' );
		$application = $appLogin();
		$assert( is_wp_error( $application ) && $application->get_error_code() === 'storage_unavailable', 'application password refuses storage failure' );
		$assert( 0 === (int) apply_filters( 'determine_current_user', false ), 'cookie refuses storage failure' );
		$error = apply_filters( 'rest_authentication_errors', null );
		$assert( is_wp_error( $error ) && $error->get_error_code() === 'storage_unavailable', 'failed cookie is an error, never anonymous REST' );
		$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $tokens['access_token'];
		$assert( 0 === (int) \SpacePress\Identity\Bearer::resolve( $uid ), 'Bearer refuses storage failure even with cookie identity' );
		$error = \SpacePress\Identity\Bearer::errors( null );
		$assert( is_wp_error( $error ) && $error->get_error_code() === 'storage_unavailable', 'failed Bearer is an error, never anonymous REST' );
		try {
			( new \SpacePress\Identity\OAuth( $db, $accounts ) )->access( $tokens['access_token'] );
			throw new RuntimeException( 'OAuth accepted storage failure' );
		} catch ( \SpacePress\Identity\Failure $e ) {
			$assert( 'storage_unavailable' === $e->kind, 'OAuth refuses storage failure' );
		}
		if ( class_exists( \SpacePress\Wp\WpAuth::class ) ) {
			wp_set_current_user( $uid );
			$assert( \SpacePress\Wp\CoreAccess::viewer() === null, 'core access refuses failed authentication instead of using anonymous policy' );
			try {
				\SpacePress\Wp\WpAuth::current();
				throw new RuntimeException( 'Runtime accepted storage failure' );
			} catch ( \SpacePress\HttpError $e ) {
				$assert( 503 === $e->status && 'storage_unavailable' === $e->errorCode, 'runtime suspension guard refuses storage failure' );
			}
		}
	} finally {
		$assert( $ddl( "ALTER TABLE {$table}_unavailable RENAME TO $table" ) !== false, 'accounts table restored' );
		$db->wp->suppress_errors( $suppress );
		unset( $_SERVER['HTTP_AUTHORIZATION'], $_COOKIE[ LOGGED_IN_COOKIE ] );
		\SpacePress\Identity\Bearer::resolve( 0 );
		apply_filters( 'determine_current_user', 0 );
		wp_set_current_user( 0 );
		remove_filter( 'wp_is_application_passwords_available', '__return_true' );
		remove_filter( 'application_password_is_api_request', '__return_true' );
	}
	// Core can return false before setting last_error (for example a disconnected handle).
	$disconnected = new class() extends wpdb {
		public function __construct() {
			$this->ready = false; }
	};
	$deadDb       = new \SpacePress\Identity\DB( $disconnected );
	foreach ( array( 'row', 'rows' ) as $method ) {
		try {
			$deadDb->$method( 'SELECT 1' );
			throw new RuntimeException( 'False query with empty last_error became missing data' );
		} catch ( \SpacePress\Identity\Failure $e ) {
			$assert( 'storage_unavailable' === $e->kind && '' === $disconnected->last_error, 'false query is unavailable even without last_error' );
		}
	}
	$liveAccounts                          = \SpacePress\Identity\Plugin::$accounts;
	\SpacePress\Identity\Plugin::$db       = $deadDb;
	\SpacePress\Identity\Plugin::$accounts = new \SpacePress\Identity\Accounts( $deadDb, \SpacePress\Identity\Plugin::$security );
	add_filter( 'wp_is_application_passwords_available', '__return_true' );
	try {
		$native = wp_authenticate( 'storage-' . $tag, $password );
		add_filter( 'application_password_is_api_request', '__return_true' );
		$application                 = $appLogin();
		$_COOKIE[ LOGGED_IN_COOKIE ] = wp_generate_auth_cookie( $uid, time() + 3600, 'logged_in' );
		$cookieUser                  = apply_filters( 'determine_current_user', false );
		$error                       = apply_filters( 'rest_authentication_errors', null );
		$assert( is_wp_error( $native ) && $native->get_error_code() === 'storage_unavailable', 'native password refuses false query with empty last_error' );
		$assert( is_wp_error( $application ) && $application->get_error_code() === 'storage_unavailable', 'application password refuses false query with empty last_error' );
		$assert( 0 === (int) $cookieUser && is_wp_error( $error ) && $error->get_error_code() === 'storage_unavailable', 'cookie refuses false query with empty last_error' );
	} finally {
		\SpacePress\Identity\Plugin::$db       = $db;
		\SpacePress\Identity\Plugin::$accounts = $liveAccounts;
		unset( $_COOKIE[ LOGGED_IN_COOKIE ] );
		apply_filters( 'determine_current_user', false );
		remove_filter( 'wp_is_application_passwords_available', '__return_true' );
		remove_filter( 'application_password_is_api_request', '__return_true' );
	}
	echo "PASS identity storage failures refuse cookie, native password, application password, Bearer/OAuth and runtime authentication\n";
	// A provider identity signs in to the account it created, on every engine. Its key is a
	// binary column, which SQLite's MySQL adapter never matched against a string.
	$issuer  = 'https://issuer.storage.test';
	$subject = 'subject-' . bin2hex( random_bytes( 6 ) );
	$first   = $accounts->provider( $issuer, $subject, $subject . '@storage.test', 'Provider Probe' );
	$again   = $accounts->provider( $issuer, $subject, $subject . '@storage.test', 'Provider Probe' );
	$assert( $first > 0 && $again === $first, 'a second provider sign-in finds the account the first created' );
	echo "PASS a provider identity signs in to its own account again\n";
} )();
