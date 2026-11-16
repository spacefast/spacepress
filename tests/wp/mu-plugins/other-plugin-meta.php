<?php
// Another plugin's post meta on a TypedPress post type (tests/wp/locales.test.ts): a core create that TypedPress
// writes (a translation's `locale`) must still store it, as core's own create does.
add_action('init', static fn () => register_post_meta('tp_tours', 'other_plugin_note', ['type' => 'string', 'single' => true, 'show_in_rest' => true]));
