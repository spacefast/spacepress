<?php
// The templates' `primary` menu location. First has no menu() builder yet, so a theme location is
// the one piece of setup left in PHP; it goes when First can declare menu locations.
add_action('after_setup_theme', static fn () => register_nav_menu('primary', 'Primary navigation'));
