<?php

declare(strict_types=1);

namespace SpacePress\Wp;

use SpacePress\Validator;

/**
 * The project's `public/` folder, stored under `wp-content/` and symlinked into the document root
 * (`sp_public_root`, default `ABSPATH`, skipped on multisite or read-only roots) so the web server
 * serves direct root requests (e.g. `/favicon.ico`, `/logo.svg`, `/files/blog.json`) straight off
 * disk without booting PHP:
 * - Static assets imported from TSX/TS or referenced by relative CSS `url(...)` live under
 *   `wp-content/.../sp/app/assets/<stem>-<hash>.<ext>` (immutable, 1-year cache).
 * - `public/` holds untouched root-URL files symlinked into the document root pointing into
 *   `wp-content/`. `metadata.scripts` appends `?spv=<hash>` from `sp/app/public-files.json`.
 * - PHP answers on `do_parse_request` for what is not linked: `/.well-known/*` (so it works even on
 *   hosts with a read-only document root), a child whose parent directory shadows a literal app
 *   route, and the top-level `index.html` at `/index.html` (never linked, so `/` stays WordPress's
 *   home page under the web server's DirectoryIndex).
 */
final class PublicFiles {

	public const MANIFEST        = 'sp/app/public-files.json';
	public const SYMLINKS_OPTION = 'sp_public_symlinks';

	/** By extension; anything else is `application/octet-stream`. */
	private const TYPES = array(
		'html'        => 'text/html; charset=utf-8',
		'htm'         => 'text/html; charset=utf-8',
		'css'         => 'text/css; charset=utf-8',
		'js'          => 'text/javascript; charset=utf-8',
		'mjs'         => 'text/javascript; charset=utf-8',
		'json'        => 'application/json',
		'map'         => 'application/json',
		'webmanifest' => 'application/manifest+json',
		'txt'         => 'text/plain; charset=utf-8',
		'md'          => 'text/markdown; charset=utf-8',
		'xml'         => 'application/xml',
		'csv'         => 'text/csv; charset=utf-8',
		'svg'         => 'image/svg+xml',
		'png'         => 'image/png',
		'jpg'         => 'image/jpeg',
		'jpeg'        => 'image/jpeg',
		'gif'         => 'image/gif',
		'webp'        => 'image/webp',
		'avif'        => 'image/avif',
		'ico'         => 'image/x-icon',
		'woff'        => 'font/woff',
		'woff2'       => 'font/woff2',
		'ttf'         => 'font/ttf',
		'otf'         => 'font/otf',
		'wasm'        => 'application/wasm',
		'pdf'         => 'application/pdf',
		'zip'         => 'application/zip',
		'gz'          => 'application/gzip',
	);

	/** `/.well-known/` names WordPress plugins and hosts answer: SpacePress Identity's discovery, the host's. */
	private const WELL_KNOWN = array( 'openid-configuration', 'oauth-authorization-server', 'jwks.json', 'spacefast-runtime', 'stattic-runtime' );

	/** Never served or linked, whatever their place in `public/`: code WordPress would run, and server config. */
	private const REFUSED = array( 'php', 'phtml', 'phar', 'php3', 'php4', 'php5', 'php7', 'php8', 'phps', 'htaccess', 'htpasswd', 'ini', 'user.ini' );

	public static function register( Plugin $plugin ): void {
		if ( is_dir( $plugin->dir . '/public/.well-known' ) || self::manifest( $plugin ) !== array() ) {
			// After the facade (0) and the app router's handlers (0), before the Markdown twins (1):
			// serves `/.well-known/*` and any `public/` child whose parent directory would shadow a
			// literal app route (kept out of the document root so Apache/nginx still routes the page).
			add_filter(
				'do_parse_request',
				static function ( bool $parse ) use ( $plugin ): bool {
					if ( $parse ) {
						self::serve_fallback( $plugin );
					}

					return $parse;
				},
				0
			);
		}
		// Sync root symlinks whenever the public manifest, source, root, or literal routes change.
		// Only live builds (never unactivated managed candidates or inspect runs) sync on `init`.
		if ( ! Runtime::inspecting() ) {
			add_action(
				'init',
				static function () use ( $plugin ): void {
					if ( self::is_live_build() ) {
						self::maybe_sync_symlinks( $plugin );
					}
				},
				1
			);
		}
	}

	/** Whether the currently loaded build is live (not an inspect run or an unactivated managed candidate). */
	private static function is_live_build(): bool {
		if ( Runtime::inspecting() ) {
			return false;
		}
		if ( ! Runtime::managed() ) {
			return true;
		}
		if ( class_exists( \SpacePressPlugin\Mount::class, false ) ) {
			$mounted = \SpacePressPlugin\Mount::mounted();
			if ( is_array( $mounted ) ) {
				return ( $mounted['mode'] ?? null ) === 'live';
			}
		}
		$loaded = class_exists( \SpacePress\Loader\Loader::class, false ) ? \SpacePress\Loader\Loader::loaded() : null;
		if ( is_array( $loaded ) && is_string( $loaded['root'] ?? null ) && is_string( $loaded['build'] ?? null ) ) {
			return is_file( $loaded['root'] . '/ready/' . $loaded['build'] . '.json' );
		}

		return false;
	}

	/** @return array<string, string> relative path below `public/` => 12-hex content version */
	public static function manifest( Plugin $plugin ): array {
		return self::manifest_for_dir( $plugin->dir );
	}

	/** @return array<string, string> */
	private static function manifest_for_dir( string $dir ): array {
		static $parsed = array();
		if ( ! isset( $parsed[ $dir ] ) ) {
			$raw            = self::manifest_raw( $dir );
			$map            = '' === $raw ? null : json_decode( $raw, true );
			$parsed[ $dir ] = is_array( $map ) ? array_filter( $map, static fn ( $v, $k ): bool => is_string( $k ) && is_string( $v ), ARRAY_FILTER_USE_BOTH ) : array();
		}

		return $parsed[ $dir ];
	}

	public static function manifestHash( Plugin $plugin ): ?string { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$raw = self::manifest_raw( $plugin->dir );

		return '' === $raw ? null : hash( 'sha256', $raw );
	}

	private static function manifest_raw( string $dir ): string {
		static $maps = array();
		if ( ! isset( $maps[ $dir ] ) ) {
			// Read as data: a loose deploy that preserves mtime must not leave old opcodes in use.
			$file         = $dir . '/' . self::MANIFEST;
			$maps[ $dir ] = is_file( $file ) ? (string) @file_get_contents( $file ) : '';
		}

		return $maps[ $dir ];
	}

	/** Content version (12-hex SHA-256) of a JavaScript file in `public/`, or null. */
	public static function scriptVersion( Plugin $plugin, string $relative ): ?string { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$ext = strtolower( pathinfo( $relative, PATHINFO_EXTENSION ) );
		if ( 'js' !== $ext && 'mjs' !== $ext ) {
			return null;
		}
		$manifest = self::manifest( $plugin );

		return $manifest[ $relative ] ?? null;
	}

	/** Whether the app's `public/` folder serves a file at `$path` (below the home URL). */
	public static function serves( Plugin $plugin, string $path ): bool {
		$rel = self::relative_path( $path, $plugin->schema->reserved() );
		if ( null !== $rel && isset( self::manifest( $plugin )[ $rel ] ) ) {
			return true;
		}

		return is_dir( $plugin->dir . '/public/.well-known' )
			&& self::well_known_file( $plugin->dir . '/public', $path ) !== null;
	}

	/**
	 * The `wp-content/` directory holding `$plugin`'s public files on disk, or null when a managed
	 * build has no public assets mirror configured (never expose a private build store via symlinks).
	 */
	public static function publicDir( Plugin $plugin ): ?string { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( Runtime::managed() ) {
			$loaded    = class_exists( \SpacePress\Loader\Loader::class, false ) ? \SpacePress\Loader\Loader::loaded() : null;
			$assetsDir = is_array( $loaded ) && is_string( $loaded['assetsDir'] ?? null ) && '' !== $loaded['assetsDir'] // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				? rtrim( $loaded['assetsDir'], '/\\' )
				: null;
			$manifest  = is_array( $loaded['manifest'] ?? null ) ? $loaded['manifest'] : null;
			if ( null === $assetsDir || null === $manifest ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				return null;
			}

			return $assetsDir . '/app/' . $manifest['app'] . '/plugins/spacepress-app-' . $manifest['name'] . '/public'; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		}

		return $plugin->dir . '/public';
	}

	/** Sync root symlinks when the manifest, source, root, or literal routes changed (or removals are pending). */
	private static function maybe_sync_symlinks( Plugin $plugin ): void {
		// No public files and no option recorded: nothing to link or clean up. The option is always
		// written autoloaded, so its absence is known from the autoloaded options without a query
		// (get_option() on a missing option costs a SELECT on every request without a persistent cache).
		if ( self::manifest( $plugin ) === array() && ! array_key_exists( self::SYMLINKS_OPTION, wp_load_alloptions() ) ) {
			return;
		}
		$root = self::document_root();
		if ( null === $root ) {
			return;
		}
		$public_dir = self::publicDir( $plugin );
		$source     = null !== $public_dir ? ( realpath( $public_dir ) ?: '' ) : ''; // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
		$hash       = self::manifestHash( $plugin ) ?? '';
		$routes     = self::routes_fingerprint( $plugin->schema );
		$stored     = get_option( self::SYMLINKS_OPTION );
		if ( is_array( $stored ) ) {
			if ( ( $stored['root'] ?? null ) === $root
				&& ( $stored['source'] ?? null ) === $source
				&& ( $stored['hash'] ?? null ) === $hash
				&& ( $stored['routes'] ?? null ) === $routes
				&& empty( $stored['pending'] ) ) {
				return;
			}
		}
		self::syncSymlinks( $plugin );
	}

	/** Fingerprint of reserved paths and literal app routes that affect symlink eligibility. */
	private static function routes_fingerprint( \SpacePress\Schema $schema ): string {
		$reserved = $schema->reserved();
		sort( $reserved );
		$literals = array();
		$app      = $schema->app();
		if ( is_array( $app ) ) {
			foreach ( $app['routes'] ?? array() as $route ) {
				$pattern = (string) ( $route['pattern'] ?? '' );
				if ( '' !== $pattern && ! str_contains( $pattern, ':' ) && ! str_contains( $pattern, '*' ) ) {
					$literals[] = $pattern;
				}
			}
		}
		sort( $literals );

		return hash(
			'sha256',
			json_encode(
				array(
					'reserved' => $reserved,
					'literals' => $literals,
				),
				JSON_UNESCAPED_SLASHES
			) ?: '' // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
		);
	}

	/**
	 * Sync symlinks in the document root (`sp_public_root`, default `ABSPATH`) pointing to the app's
	 * `public/` files under `wp-content/`, so direct requests like `/logo.svg` or `/files/blog.json`
	 * are served directly by the web server without booting PHP. Skipped on multisite or when the
	 * document root is not writable. Never overwrites existing non-symlink files, never links
	 * top-level `index.html`, never creates directories that shadow literal app routes, and cleans
	 * up stale symlinks from previous builds.
	 */
	public static function syncSymlinks( Plugin $plugin ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$public_dir = self::publicDir( $plugin );
		if ( null === $public_dir ) {
			return;
		}
		self::syncSymlinksForDir( $plugin->dir, $public_dir, $plugin->schema );
	}

	public static function syncSymlinksForDir( string $appDir, string $publicDir, \SpacePress\Schema $schema ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		$root = self::document_root();
		if ( null === $root ) {
			return;
		}
		$stored        = get_option( self::SYMLINKS_OPTION );
		$prev_root     = is_array( $stored ) && is_string( $stored['root'] ?? null ) ? rtrim( $stored['root'], '/\\' ) : $root;
		$prev_links    = is_array( $stored ) && is_array( $stored['links'] ?? null ) ? array_values( array_filter( $stored['links'], 'is_string' ) ) : array();
		$prev_dirs     = is_array( $stored ) && is_array( $stored['dirs'] ?? null ) ? array_values( array_filter( $stored['dirs'], 'is_string' ) ) : array();
		$prev_stale    = is_array( $stored ) && is_array( $stored['stale'] ?? null ) ? $stored['stale'] : array();
		$prev_link_set = array_fill_keys( $prev_links, true );

		$source_top = is_dir( $publicDir ) ? realpath( $publicDir ) : false; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$manifest   = self::manifest_for_dir( $appDir ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$raw        = self::manifest_raw( $appDir ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$hash       = '' === $raw ? '' : hash( 'sha256', $raw );
		$routes     = self::routes_fingerprint( $schema );
		$reserved   = $schema->reserved();

		$desired = array();
		if ( false !== $source_top && array() !== $manifest ) {
			foreach ( array_keys( $manifest ) as $rel ) {
				// Never symlink top-level index.html/htm: Apache/nginx DirectoryIndex would serve it for `/`.
				$lower = strtolower( $rel );
				if ( 'index.html' === $lower || 'index.htm' === $lower ) {
					continue;
				}
				if ( self::relative_path( '/' . $rel, $reserved ) !== $rel ) {
					continue;
				}
				$page_path = '/' . ( str_ends_with( $lower, '/index.html' ) ? substr( $rel, 0, -strlen( '/index.html' ) ) : $rel );
				if ( self::literal_page( $schema, $page_path ) || self::parent_shadows_literal_page( $schema, $rel ) ) {
					continue;
				}
				$real = realpath( $source_top . '/' . $rel );
				if ( false === $real || ! str_starts_with( $real, $source_top . DIRECTORY_SEPARATOR ) || ! is_file( $real ) ) {
					continue;
				}
				if ( self::is_refused_name( basename( $real ) ) ) {
					continue;
				}
				$dot = false;
				foreach ( explode( DIRECTORY_SEPARATOR, substr( $real, strlen( $source_top ) + 1 ) ) as $part ) {
					if ( str_starts_with( $part, '.' ) ) {
						$dot = true;
						break;
					}
				}
				if ( ! $dot ) {
					$desired[ $rel ] = $real;
				}
			}
		}

		// Retry any previously failed removals from earlier roots first.
		$stale = self::retry_stale( $prev_stale );

		// Remove symlinks from previous builds that are no longer desired (or moved root).
		// Keep any link whose removal fails (with its original root) so later syncs or deactivation retry it.
		$pending_links = array();
		foreach ( $prev_links as $old ) {
			if ( $prev_root !== $root || ! isset( $desired[ $old ] ) ) {
				$path = $prev_root . '/' . $old;
				if ( is_link( $path ) && ! @unlink( $path ) && is_link( $path ) ) {
					error_log( "SpacePress: could not remove stale public symlink $path" );
					if ( $prev_root === $root ) {
						$pending_links[] = $old;
					} else {
						$stale[] = array(
							'root' => $prev_root,
							'path' => $old,
							'dir'  => false,
						);
					}
				}
			}
		}

		$created_links = array();
		$owned_dirs    = $prev_root === $root ? array_fill_keys( $prev_dirs, true ) : array();
		foreach ( $desired as $rel => $target ) {
			$dest     = $root . '/' . $rel;
			$dir_ok   = true;
			$segments = explode( '/', $rel );
			array_pop( $segments );
			$cur = '';
			foreach ( $segments as $seg ) {
				$cur      = '' === $cur ? $seg : $cur . '/' . $seg;
				$dir_path = $root . '/' . $cur;
				if ( is_link( $dir_path ) || ( file_exists( $dir_path ) && ! is_dir( $dir_path ) ) ) {
					$dir_ok = false;
					break;
				}
				if ( ! is_dir( $dir_path ) ) {
					if ( ! @mkdir( $dir_path, 0755 ) ) {
						$dir_ok = false;
						break;
					}
					$owned_dirs[ $cur ] = true;
				}
			}
			if ( ! $dir_ok ) {
				continue;
			}
			if ( is_link( $dest ) ) {
				if ( @readlink( $dest ) === $target ) {
					$created_links[] = $rel;
					continue;
				}
				if ( $prev_root === $root && isset( $prev_link_set[ $rel ] ) ) {
					if ( @unlink( $dest ) || ! is_link( $dest ) ) {
						// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- The false result triggers the file-copy fallback on hosts without symlinks.
						if ( @symlink( $target, $dest ) ) {
							$created_links[] = $rel;
						}
					} else {
						error_log( "SpacePress: could not replace public symlink $dest" );
						$pending_links[] = $rel;
					}
				}
				continue;
			}
			if ( file_exists( $dest ) ) {
				// Never overwrite a real file or directory already in the document root.
				continue;
			}
			// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- The false result triggers the file-copy fallback on hosts without symlinks.
			if ( @symlink( $target, $dest ) ) {
				$created_links[] = $rel;
			}
		}

		// Retain ownership of any failed removals under the current root so they are retried.
		$recorded_links = $created_links;
		if ( $prev_root === $root && array() !== $pending_links ) {
			$recorded_links = array_values( array_unique( array_merge( $recorded_links, $pending_links ) ) );
		}

		// Prune empty directories SpacePress previously created that no remaining symlink uses.
		$needed_dirs = array();
		foreach ( $recorded_links as $rel ) {
			$dir = dirname( $rel );
			while ( '.' !== $dir && '' !== $dir ) {
				$needed_dirs[ $dir ] = true;
				$dir                 = dirname( $dir );
			}
		}
		$pending_dirs = false;
		$prune_list   = $prev_root === $root ? array_keys( $owned_dirs ) : $prev_dirs;
		usort( $prune_list, static fn ( string $a, string $b ): int => substr_count( $b, '/' ) <=> substr_count( $a, '/' ) ?: strlen( $b ) <=> strlen( $a ) ); // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
		foreach ( $prune_list as $dir ) {
			if ( $prev_root !== $root || ! isset( $needed_dirs[ $dir ] ) ) {
				$dir_path = $prev_root . '/' . $dir;
				if ( ! is_dir( $dir_path ) || @rmdir( $dir_path ) || ! is_dir( $dir_path ) ) {
					unset( $owned_dirs[ $dir ] );
				} else {
					error_log( "SpacePress: could not remove stale public directory $dir_path" );
					$pending_dirs = true;
					if ( $prev_root !== $root ) {
						$stale[] = array(
							'root' => $prev_root,
							'path' => $dir,
							'dir'  => true,
						);
					}
				}
			}
		}
		$kept_dirs   = array_values( array_keys( $owned_dirs ) );
		$has_pending = array() !== $pending_links || $pending_dirs || array() !== $stale;

		// An app with no public files and nothing linked, owned or pending records nothing (its `{}`
		// manifest still has a hash), so activation leaves what initialize leaves: no option.
		if ( array() === $recorded_links && array() === $kept_dirs && array() === $manifest && ! $has_pending ) {
			delete_option( self::SYMLINKS_OPTION );
		} else {
			update_option(
				self::SYMLINKS_OPTION,
				array(
					'root'    => $root,
					'source'  => $source_top ? $source_top : '',
					'hash'    => $hash,
					'routes'  => $routes,
					'links'   => $recorded_links,
					'dirs'    => $kept_dirs,
					'stale'   => $stale,
					'pending' => $has_pending,
				),
				true
			);
		}
	}

	/** Remove every symlink and empty directory SpacePress created in the document root. */
	public static function removeSymlinks(): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$stored = get_option( self::SYMLINKS_OPTION );
		if ( ! is_array( $stored ) || ! is_string( $stored['root'] ?? null ) || '' === $stored['root'] ) {
			delete_option( self::SYMLINKS_OPTION );

			return;
		}
		$root            = rtrim( $stored['root'], '/\\' );
		$stale           = self::retry_stale( is_array( $stored['stale'] ?? null ) ? $stored['stale'] : array() );
		$remaining_links = array();
		foreach ( is_array( $stored['links'] ?? null ) ? $stored['links'] : array() as $rel ) {
			if ( ! is_string( $rel ) || '' === $rel ) {
				continue;
			}
			$path = $root . '/' . $rel;
			if ( is_link( $path ) && ! @unlink( $path ) && is_link( $path ) ) {
				error_log( "SpacePress: could not remove public symlink $path during cleanup" );
				$remaining_links[] = $rel;
			}
		}
		$dirs = is_array( $stored['dirs'] ?? null ) ? array_values( array_filter( $stored['dirs'], 'is_string' ) ) : array();
		usort( $dirs, static fn ( string $a, string $b ): int => substr_count( $b, '/' ) <=> substr_count( $a, '/' ) ?: strlen( $b ) <=> strlen( $a ) ); // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
		$remaining_dirs = array();
		foreach ( $dirs as $dir ) {
			if ( '' === $dir ) {
				continue;
			}
			$dir_path = $root . '/' . $dir;
			if ( is_dir( $dir_path ) && ! @rmdir( $dir_path ) && is_dir( $dir_path ) ) {
				error_log( "SpacePress: could not remove public directory $dir_path during cleanup" );
				$remaining_dirs[] = $dir;
			}
		}
		if ( array() === $remaining_links && array() === $remaining_dirs && array() === $stale ) {
			delete_option( self::SYMLINKS_OPTION );
		} else {
			update_option(
				self::SYMLINKS_OPTION,
				array(
					'root'    => $root,
					'source'  => '',
					'hash'    => '',
					'routes'  => '',
					'links'   => $remaining_links,
					'dirs'    => $remaining_dirs,
					'stale'   => $stale,
					'pending' => true,
				),
				true
			);
		}
	}

	/**
	 * Retry removals that previously failed under an earlier document root, returning any still present.
	 *
	 * @param list<mixed> $entries
	 * @return list<array{root: string, path: string, dir: bool}>
	 */
	private static function retry_stale( array $entries ): array {
		$links = array();
		$dirs  = array();
		foreach ( $entries as $entry ) {
			if ( ! is_array( $entry ) || ! is_string( $entry['root'] ?? null ) || ! is_string( $entry['path'] ?? null ) || '' === $entry['root'] || '' === $entry['path'] ) {
				continue;
			}
			$item = array(
				'root' => rtrim( $entry['root'], '/\\' ),
				'path' => $entry['path'],
				'dir'  => ! empty( $entry['dir'] ),
			);
			if ( $item['dir'] ) {
				$dirs[] = $item;
			} else {
				$links[] = $item;
			}
		}
		$remaining = array();
		foreach ( $links as $item ) {
			$full = $item['root'] . '/' . $item['path'];
			if ( is_link( $full ) && ! @unlink( $full ) && is_link( $full ) ) {
				error_log( "SpacePress: could not remove stale public symlink $full" );
				$remaining[] = $item;
			}
		}
		usort( $dirs, static fn ( array $a, array $b ): int => substr_count( $b['path'], '/' ) <=> substr_count( $a['path'], '/' ) ?: strlen( $b['path'] ) <=> strlen( $a['path'] ) ); // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
		foreach ( $dirs as $item ) {
			$full = $item['root'] . '/' . $item['path'];
			if ( is_dir( $full ) && ! @rmdir( $full ) && is_dir( $full ) ) {
				error_log( "SpacePress: could not remove stale public directory $full" );
				$remaining[] = $item;
			}
		}

		return $remaining;
	}

	/** Writable document root for root symlinks, or null on multisite / read-only hosts. */
	private static function document_root(): ?string {
		if ( function_exists( 'is_multisite' ) && is_multisite() ) {
			return null;
		}
		$default = rtrim( ABSPATH, '/\\' );
		$root    = function_exists( 'apply_filters' ) ? apply_filters( 'sp_public_root', $default ) : $default;
		if ( ! is_string( $root ) || '' === $root ) {
			return null;
		}
		$root = rtrim( $root, '/\\' );
		if ( ! is_dir( $root ) && $root !== $default ) {
			@mkdir( $root, 0755, true );
		}

		return is_dir( $root ) && is_writable( $root ) ? $root : null;
	}

	/**
	 * The `public/` file PHP answers this request with (one the document root has no link for:
	 * `/.well-known/*`, a route-shadowed child, the top-level `index.html`), or null.
	 */
	public static function fallbackFile( Plugin $plugin ): ?string { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$method = strtoupper( (string) ( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) );
		if ( 'GET' !== $method && 'HEAD' !== $method || MarkdownTwins::negotiating() ) {
			return null;
		}
		$req_path = self::request_path();
		if ( null === $req_path || self::literal_page( $plugin->schema, $req_path ) ) {
			return null;
		}

		return self::well_known_file( $plugin->dir . '/public', $req_path ) ?? self::unlinked_public_file( $plugin, $req_path );
	}

	/** Serve `/.well-known/*`, route-shadowed `public/` children and `/index.html` via PHP. */
	private static function serve_fallback( Plugin $plugin ): void {
		$file = self::fallbackFile( $plugin );
		if ( null === $file ) {
			return;
		}
		$method    = strtoupper( (string) ( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) );
		$extension = strtolower( pathinfo( $file, PATHINFO_EXTENSION ) );
		$size      = (int) filesize( $file );
		$etag      = '"' . dechex( $size ) . '-' . dechex( (int) filemtime( $file ) ) . '"';
		$headers   = array(
			'Content-Type'                => self::TYPES[ $extension ] ?? 'application/octet-stream',
			'Cache-Control'               => 'public, max-age=300',
			'ETag'                        => $etag,
			'X-Content-Type-Options'      => 'nosniff',
			'Access-Control-Allow-Origin' => '*',
		);
		if ( 'svg' === $extension || 'xml' === $extension ) {
			$headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
		}
		if ( Validator::matches( $etag ) ) {
			self::emit( 304, $headers, null );
		}
		$headers['Content-Length'] = (string) $size;
		self::emit( 200, $headers, 'HEAD' === $method ? null : $file );
	}

	/**
	 * Resolves a `public/` file the document root has no link for: the top-level `index.html` (or
	 * `index.htm`), asked for by name, or a file whose parent directory shadows a literal app route.
	 */
	private static function unlinked_public_file( Plugin $plugin, string $path ): ?string {
		$rel = self::relative_path( $path, $plugin->schema->reserved() );
		if ( null === $rel || ! isset( self::manifest( $plugin )[ $rel ] ) ) {
			return null;
		}
		// `/` stays WordPress's home page: relativePath() gives no name for it, so only a request
		// that names the file (`/index.html`) reaches it.
		$root_index = in_array( strtolower( $rel ), array( 'index.html', 'index.htm' ), true ) && ! str_ends_with( $path, '/' );
		if ( ! $root_index && ! self::parent_shadows_literal_page( $plugin->schema, $rel ) ) {
			return null;
		}
		$public_dir = self::publicDir( $plugin ) ?? ( $plugin->dir . '/public' );
		$top        = is_dir( $public_dir ) ? realpath( $public_dir ) : false;
		if ( false === $top ) {
			return null;
		}
		$real = realpath( $top . '/' . $rel );
		if ( false === $real || ! str_starts_with( $real, $top . DIRECTORY_SEPARATOR ) || ! is_file( $real ) || self::is_refused_name( basename( $real ) ) ) {
			return null;
		}
		foreach ( explode( DIRECTORY_SEPARATOR, substr( $real, strlen( $top ) + 1 ) ) as $part ) {
			if ( str_starts_with( $part, '.' ) ) {
				return null;
			}
		}

		return $real;
	}

	/** Whether any parent directory prefix of `$rel` (e.g. `docs` for `docs/guide.pdf`) matches a literal app route. */
	private static function parent_shadows_literal_page( \SpacePress\Schema $schema, string $rel ): bool {
		$segments = explode( '/', $rel );
		array_pop( $segments );
		$cur = '';
		foreach ( $segments as $seg ) {
			$cur = '' === $cur ? $seg : $cur . '/' . $seg;
			if ( self::literal_page( $schema, '/' . $cur ) ) {
				return true;
			}
		}

		return false;
	}

	/** Whether any dot-separated part (or full basename) of `$name` is a refused executable/config extension. */
	private static function is_refused_name( string $name ): bool {
		$lower = strtolower( $name );
		if ( in_array( $lower, self::REFUSED, true ) ) {
			return true;
		}
		foreach ( explode( '.', $lower ) as $part ) {
			if ( in_array( $part, self::REFUSED, true ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Resolves a `/.well-known/*` path to a regular file strictly inside `$root/.well-known`, or
	 * null for any other path, reserved `.well-known` name, dotfile, refused extension, or symlink
	 * escaping `$root/.well-known`.
	 */
	private static function well_known_file( string $root, ?string $relative = null ): ?string {
		$path = $relative ?? self::request_path();
		if ( null === $path || ! str_starts_with( $path, '/.well-known/' ) ) {
			return null;
		}
		$index    = str_ends_with( $path, '/' );
		$segments = self::decode_segments( $path, allow_well_known: true );
		if ( null === $segments || count( $segments ) < 2 || strtolower( $segments[0] ) !== '.well-known' ) {
			return null;
		}
		if ( in_array( strtolower( $segments[1] ), self::WELL_KNOWN, true ) ) {
			return null;
		}
		if ( $index ) {
			$segments[] = 'index.html';
		}
		$name = (string) end( $segments );
		if ( self::is_refused_name( $name ) ) {
			return null;
		}
		$top  = realpath( $root . '/.well-known' );
		$real = realpath( $root . '/' . implode( '/', $segments ) );
		if ( false === $real || false === $top || ! str_starts_with( $real, $top . DIRECTORY_SEPARATOR ) || ! is_file( $real ) ) {
			return null;
		}
		if ( self::is_refused_name( basename( $real ) ) ) {
			return null;
		}
		foreach ( explode( DIRECTORY_SEPARATOR, substr( $real, strlen( $top ) + 1 ) ) as $part ) {
			if ( str_starts_with( $part, '.' ) ) {
				return null;
			}
		}

		return $real;
	}

	/** Request path below `home_url('/')`, or null if outside the site's base path. */
	private static function request_path(): ?string {
		$path = (string) ( wp_parse_url( wp_unslash( (string) ( $_SERVER['REQUEST_URI'] ?? '/' ) ), PHP_URL_PATH ) ?? '/' );
		$base = rtrim( (string) ( wp_parse_url( home_url( '/' ), PHP_URL_PATH ) ?? '/' ), '/' );
		if ( '' !== $base ) {
			if ( $path !== $base && ! str_starts_with( $path, $base . '/' ) ) {
				return null;
			}
			$path = substr( $path, strlen( $base ) ) ?: '/'; // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
		}

		return $path;
	}

	/**
	 * Normalized relative path below `public/` for a non-well-known URL path, or null when invalid,
	 * reserved, dotfile, or refused.
	 *
	 * @param list<string> $reserved
	 */
	private static function relative_path( string $path, array $reserved ): ?string {
		$index    = str_ends_with( $path, '/' );
		$segments = self::decode_segments( $path, allow_well_known: false );
		if ( null === $segments || array() === $segments ) {
			return null;
		}
		$first = strtolower( $segments[0] );
		if ( in_array( $first, $reserved, true ) || str_starts_with( $first, 'wp-' ) ) {
			return null;
		}
		if ( $index ) {
			$segments[] = 'index.html';
		}
		$name = (string) end( $segments );
		if ( self::is_refused_name( $name ) ) {
			return null;
		}

		return implode( '/', $segments );
	}

	/** @return ?list<string> */
	private static function decode_segments( string $path, bool $allow_well_known ): ?array {
		$segments = array();
		foreach ( explode( '/', trim( $path, '/' ) ) as $raw ) {
			if ( '' === $raw ) {
				continue;
			}
			if ( preg_match( '/%(?![0-9A-Fa-f]{2})/', $raw ) === 1 ) {
				return null;
			}
			$segment = rawurldecode( $raw );
			$dot     = str_starts_with( $segment, '.' ) && ! ( $allow_well_known && array() === $segments && '.well-known' === $segment );
			if ( '.' === $segment || '..' === $segment || $dot || str_contains( $segment, "\0" ) || str_contains( $segment, '/' ) || str_contains( $segment, '\\' )
				|| str_contains( $segment, ':' ) || str_ends_with( $segment, '.' ) || str_ends_with( $segment, ' ' ) ) {
				return null;
			}
			$segments[] = $segment;
		}

		return $segments;
	}

	/** Whether a literal `sp/app/` page or route matches `$path`: the app's code wins over a file. */
	private static function literal_page( \SpacePress\Schema $schema, ?string $path ): bool {
		$app = $schema->app();
		if ( ! is_array( $app ) || null === $path ) {
			return false;
		}
		$literal_only = array(
			'literal' => $app['routeIndex']['literal'],
			'dynamic' => array(),
		);

		return AppRouter::match( $app['routes'], $path, $literal_only ) !== null;
	}

	/** @param array<string, string> $headers */
	private static function emit( int $status, array $headers, ?string $file ): never {
		if ( function_exists( 'batcache_cancel' ) ) {
			batcache_cancel();
		}
		while ( ob_get_level() > 0 ) {
			ob_end_clean();
		}
		status_header( $status );
		foreach ( $headers as $name => $value ) {
			header( "$name: $value" );
		}
		if ( null !== $file ) {
			readfile( $file );
		}
		exit;
	}
}
