<?php
// Another plugin's hooks on core's post routes, for tests/wp/facade.test.ts: a registered REST field
// and the rest_insert/rest_after_insert actions, which must see the API's writes as core's.
add_action(
	'rest_api_init',
	static function (): void {
		register_rest_field(
			'sp_events',
			'probe_note',
			array(
				'get_callback'    => static fn ( array $post ): string => (string) get_post_meta( $post['id'], 'probe_note', true ),
				'update_callback' => static function ( mixed $value, \WP_Post $post ): ?\WP_Error {
					if ( 'refuse' === $value ) {
						return new \WP_Error( 'probe_refused', 'The probe refuses this value', array( 'status' => 400 ) );
					}
					update_post_meta( $post->ID, 'probe_note', (string) $value );

					return null;
				},
				'schema'          => array(
					'type'    => 'string',
					'context' => array( 'view', 'edit' ),
				),
			)
		);
	}
);
foreach ( array( 'rest_insert_sp_events', 'rest_after_insert_sp_events' ) as $hook ) {
	add_action(
		$hook,
		static function ( \WP_Post $post, \WP_REST_Request $request, bool $creating ) use ( $hook ): void {
			add_post_meta( $post->ID, 'probe_hooks', $hook . ( $creating ? ':create' : ':update' ) );
		},
		10,
		3
	);
}
