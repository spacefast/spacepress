<?php
/* Plugin Name: Coediting non-REST taxonomy test fixture */
// Exercise a plugin changing the registered taxonomy after schema compilation.
add_filter(
	'register_taxonomy_args',
	static function ( array $args, string $taxonomy ): array {
		if ( 'sp_hidden_tags' === $taxonomy ) {
			$args['show_in_rest'] = false;
		}
		return $args;
	},
	1000,
	2
);
