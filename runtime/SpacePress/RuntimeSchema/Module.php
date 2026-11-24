<?php

declare(strict_types=1);

namespace SpacePress\RuntimeSchema;

use SpacePress\App;
use SpacePress\Extensions;
use SpacePress\HttpError;
use SpacePress\Viewer;
use SpacePress\Wp\Runtime;
use SpacePress\Wp\SchemaVersions;

/**
 * The runtime schema's own routes under `/wp-json/spacepress/v1/schema-versions` (spec §2.10; the hyphen keeps it clear of every kind name). Registered for
 * every app; an app without `runtimeSchema: true` answers 404, as it would for any unknown path.
 *
 *   GET /schema-versions/lock     the site's active version as `sp/_generated/runtime-schema.json`
 *                          (`spacepress pull` writes it), plus what a deploy of the build this request
 *                          runs would report. Administrators only: it is the site's configuration.
 */
final class Module {

	public static function register(): void {
		Surfaces::register();
		Extensions::route( 'schema-versions', self::route( ... ) );
		// The description reports a broken chain as soon as there is one, not only once something has
		// read the versions (and recorded the problem on the option).
		Extensions::schemaDescribe(
			static function ( array $description ): array {
				if ( ! isset( $description['runtimeSchema'] ) || isset( $description['runtimeSchema']['problem'] ) ) {
					return $description;
				}
				$plugin  = class_exists( Runtime::class, false ) ? Runtime::plugin() : null;
				$problem = null === $plugin ? null : SchemaVersions::of( $plugin )?->problem();
				if ( null !== $problem ) {
					$description['runtimeSchema']['problem'] = $problem;
				}

				return $description;
			}
		);
	}

	public static function route( string $method, array $parts, array $query, string $body, Viewer $viewer ): array {
		$plugin   = class_exists( Runtime::class, false ) ? Runtime::plugin() : null;
		$versions = null === $plugin ? null : SchemaVersions::of( $plugin );
		if ( null === $versions ) {
			throw HttpError::notFound( 'This app does not use runtime schema changes (runtimeSchema: true in spacepress.config.ts)' );
		}
		if ( array_slice( $parts, 1 ) !== array( 'lock' ) ) {
			throw HttpError::notFound( 'No such schema route' );
		}
		App::allow( $method, array( 'GET' ) );
		if ( null === $viewer->user ) {
			throw new HttpError( 401, 'unauthenticated', 'Sign in as an administrator to read the site\'s schema versions' );
		}
		if ( ( $viewer->user['role'] ?? null ) !== 'admin' ) {
			throw new HttpError( 403, 'forbidden', 'Only an administrator reads the site\'s schema versions' );
		}

		return array(
			200,
			array(
				'lock'   => $versions->lock(),
				'deploy' => $versions->deployCheck(),
			),
		);
	}
}
