<?php
// Another plugin's post meta on a SpacePress post type (tests/wp/locales.test.ts): a core create that SpacePress
// writes (a translation's `locale`) must still store it, as core's own create does.
add_action(
	'init',
	static fn () => register_post_meta(
		'sp_tours',
		'other_plugin_note',
		array(
			'type'         => 'string',
			'single'       => true,
			'show_in_rest' => true,
		)
	)
);
