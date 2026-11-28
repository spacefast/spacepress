<?php
// Abilities lane only: a third-party plugin's ability, as WooCommerce or Jetpack would register one.
add_action(
	'wp_abilities_api_categories_init',
	static fn () => wp_register_ability_category(
		'acme',
		array(
			'label'       => 'Acme',
			'description' => 'Acme lane tools',
		)
	)
);
add_action(
	'wp_abilities_api_init',
	static function (): void {
		wp_register_ability(
			'acme/word-count',
			array(
				'label'               => 'Word count',
				'description'         => 'Counts the words of a text for the signed-in user.',
				'category'            => 'acme',
				'input_schema'        => array(
					'type'       => 'object',
					'properties' => array(
						'text' => array( 'type' => 'string' ),
						'unit' => array(
							'type' => 'string',
							'enum' => array( 'words', 'letters' ),
						),
					),
					'required'   => array( 'text' ),
				),
				'output_schema'       => array(
					'type'       => 'object',
					'properties' => array(
						'count' => array( 'type' => 'integer' ),
						'by'    => array( 'type' => 'string' ),
					),
					'required'   => array( 'count', 'by' ),
				),
				'permission_callback' => static fn () => current_user_can( 'edit_posts' ),
				'execute_callback'    => static fn ( array $in ) => array(
					'count' => ( $in['unit'] ?? 'words' ) === 'letters' ? strlen( preg_replace( '/\W/', '', $in['text'] ) ) : str_word_count( $in['text'] ),
					'by'    => wp_get_current_user()->user_login,
				),
				'meta'                => array( 'show_in_rest' => true ),
			)
		);
	}
);
