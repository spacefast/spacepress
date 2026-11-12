<?php
// A theme menu location for the facade's menus tests (tests/wp/facade.test.ts): the harness's block
// theme registers none.
add_action('after_setup_theme', static fn () => register_nav_menu('primary', 'Primary'));
