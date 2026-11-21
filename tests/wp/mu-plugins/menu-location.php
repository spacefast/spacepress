<?php
// Theme menu locations for the facade's menus tests (tests/wp/facade.test.ts): the harness's block
// theme registers none. The names past `primary` need percent-encoding in a URL; `a%20b` is that
// literal text, which a path decoded twice would never reach.
add_action('after_setup_theme', static fn () => register_nav_menus(['primary' => 'Primary', 'side menu' => 'Side', 'été' => 'Summer', '50%' => 'Half', 'a%20b' => 'Literal']));
