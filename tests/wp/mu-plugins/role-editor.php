<?php
// Test stack only: what a role-editor plugin does, behind a route the administrator calls. It changes a
// role's definition through WordPress's own API (WP_Role::add_cap, remove_role), for the schema lock's
// tests (tests/wp/hardening/schema-lock.test.ts).
add_action(
	'rest_api_init',
	static function (): void {
		register_rest_route(
			'spacepress-test/v1',
			'/role',
			array(
				'methods'             => 'POST',
				'permission_callback' => static fn (): bool => current_user_can( 'promote_users' ),
				'callback'            => static function ( WP_REST_Request $request ): array {
					$role = (string) $request['role'];
					if ( $request['remove'] ) {
						remove_role( $role );
					} else {
						get_role( $role )?->add_cap( (string) $request['cap'] );
					}

					return array( 'role' => get_role( $role )?->capabilities );
				},
			)
		);
	}
);
