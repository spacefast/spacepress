<?php
declare(strict_types=1);

namespace SpacePressPlugin;

/**
 * The site's deployments as a screen in SpacePress Admin (`/wp-admin/new/`), the admin a SpacePress app ships by
 * default: every deployment and switch, newest first, with "Make live" on an earlier build. It is the
 * same list the SpacePress screen in classic wp-admin shows ({@see Setup}), read through two abilities so
 * the admin runs them as the signed-in person:
 *
 *   sp/deployments          read-only: the list
 *   sp/deployments-live     make an earlier build live again ({@see Receiver::rollback()})
 *
 * Both are for people who may deploy, and neither is offered to agents: making a build live changes
 * the code the site runs.
 */
final class Deployments {

	public const LIST = 'sp/deployments';
	public const LIVE = 'sp/deployments-live';

	public static function category(): void {
		wp_register_ability_category(
			'spacepress',
			array(
				'label'       => 'SpacePress',
				'description' => 'The SpacePress app this site runs: its deployments.',
			)
		);
	}

	public static function abilities(): void {
		$allowed = static fn (): bool|\WP_Error => Receiver::authorized( false );
		$hidden  = array(
			'public'       => false,
			'show_in_rest' => true,
			'mcp'          => array( 'public' => false ),
		);
		wp_register_ability(
			self::LIST,
			array(
				'label'               => 'List deployments',
				'description'         => 'Every deployment of a SpacePress app to this site and every switch to an earlier build, newest first.',
				'category'            => 'spacepress',
				'input_schema'        => array(
					'type'                 => array( 'object', 'null' ),
					'properties'           => (object) array(),
					'additionalProperties' => false,
				),
				'output_schema'       => array(
					'type'       => 'object',
					'properties' => array(
						'deployments' => array(
							'type'  => 'array',
							'items' => array( 'type' => 'object' ),
						),
					),
				),
				'permission_callback' => $allowed,
				'execute_callback'    => static fn (): array => array( 'deployments' => self::rows() ),
				'meta'                => $hidden + array(
					'annotations' => array(
						'readonly'    => true,
						'destructive' => false,
						'idempotent'  => true,
					),
				),
			)
		);
		wp_register_ability(
			self::LIVE,
			array(
				'label'               => 'Make an earlier build live',
				'description'         => 'Switch the site to a build that was live here before. Code only: database migrations are not undone.',
				'category'            => 'spacepress',
				'input_schema'        => array(
					'type'                 => 'object',
					'required'             => array( 'build' ),
					'additionalProperties' => false,
					'properties'           => array(
						'build' => array(
							'type'    => 'string',
							'pattern' => '^[0-9a-f]{64}$',
						),
					),
				),
				'output_schema'       => array(
					'type'       => 'object',
					'properties' => array( 'live' => array( 'type' => 'string' ) ),
				),
				'permission_callback' => static fn (): bool|\WP_Error => Receiver::authorized( true ),
				'execute_callback'    => static function ( mixed $input ): array|\WP_Error {
					$build = is_array( $input ) ? (string) ( $input['build'] ?? '' ) : '';
					try {
						Receiver::rollback( $build );
					} catch ( \RuntimeException $error ) {
						return new \WP_Error( 'sp_unknown_build', $error->getMessage(), array( 'status' => 409 ) );
					}

					return array( 'live' => $build );
				},
				'meta'                => $hidden + array(
					'annotations' => array(
						'readonly'    => false,
						'destructive' => false,
						'idempotent'  => true,
					),
				),
			)
		);
	}

	/**
	 * The history, newest first, one row per entry. `id` is the entry's place in the history, because
	 * one build can be in it several times (deployed, then made live again).
	 *
	 * @return list<array{id: int, at: string, build: string, short: string, app: string, by: string, how: string, state: string}>
	 */
	public static function rows(): array {
		$live = Site::live();
		$rows = array();
		foreach ( Site::history() as $i => $entry ) {
			$build  = (string) ( $entry['build'] ?? '' );
			$user   = get_userdata( (int) ( $entry['user'] ?? 0 ) );
			$rows[] = array(
				'id'    => $i + 1,
				'at'    => (string) ( $entry['at'] ?? '' ),
				'build' => $build,
				'short' => substr( $build, 0, 12 ),
				'app'   => (string) ( $entry['name'] ?? '' ),
				'by'    => $user instanceof \WP_User ? $user->user_login : 'user ' . (int) ( $entry['user'] ?? 0 ),
				'how'   => ( $entry['kind'] ?? '' ) === 'rollback' ? 'Made live again' : 'Deployed',
				// What the build is now, which decides whether it can be made live from here. A
				// pre-release build is kept as a record, whole, and never made live.
				'state' => match ( true ) {
					$build === $live => 'Live',
					( $manifest = Site::manifest( $build ) ) !== null && Legacy::build( $manifest ) => 'Pre-release (record)',
					null !== $manifest && Site::ready( $build ) && Site::complete( $manifest ) => 'Stored',
					default => 'Files gone',
				},
			);
		}

		return array_reverse( $rows );
	}

	public static function screen(): void {
		if ( ! function_exists( 'sp_admin_register_screen' ) ) {
			return;
		}
		sp_admin_register_screen(
			'spacepress-deployments',
			array(
				'title'       => 'Deployments',
				'description' => 'Every deployment to this site, newest first.',
				'capability'  => Site::CAPABILITY,
				// Classic wp-admin already has the SpacePress screen, which lists them with the setup steps.
				'classic'     => false,
				'menu'        => array( 'icon' => 'dashicons-cloud-upload' ),
				'view'        => array(
					'ability' => self::LIST,
					'items'   => 'deployments',
					'id'      => 'id',
					'fields'  => array(
						array(
							'id'    => 'short',
							'label' => 'Build',
						),
						array(
							'id'    => 'at',
							'label' => 'When',
							'type'  => 'datetime',
						),
						array(
							'id'    => 'app',
							'label' => 'App',
						),
						array(
							'id'    => 'by',
							'label' => 'Who',
						),
						array(
							'id'    => 'how',
							'label' => 'How',
						),
						array(
							'id'    => 'state',
							'label' => 'Now',
						),
					),
					'layout'  => array(
						'type'       => 'table',
						'fields'     => array( 'at', 'app', 'by', 'how', 'state' ),
						'titleField' => 'short',
						'sort'       => array(
							'field'     => 'at',
							'direction' => 'desc',
						),
					),
				),
				'actions'     => array(
					array(
						'id'      => 'live',
						'label'   => 'Make live',
						'ability' => self::LIVE,
						'input'   => array( 'build' => '{item.build}' ),
						'confirm' => 'Make this build the live one? The site switches to its code. Database migrations are not undone.',
					),
				),
				'data'        => static function (): array {
					$lines = array( 'Deploy from a project with spacepress push. Making an earlier build live switches the code only: database migrations are not undone.' );
					foreach ( array_filter( array( Site::closed(), Site::exposure() ) ) as $warning ) {
						$lines[] = $warning;
					}

					return $lines;
				},
			)
		);
	}
}
