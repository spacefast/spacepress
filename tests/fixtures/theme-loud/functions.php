<?php

// As WordPress 7.2's default theme does it: the stylesheet is registered with its path, so core
// prints it inline (`<style id="loud-style-inline-css">`).
add_action('wp_enqueue_scripts', static function (): void {
    wp_register_style('loud-style', get_parent_theme_file_uri('style.css'), [], '1.0.0');
    wp_style_add_data('loud-style', 'path', get_parent_theme_file_path('style.css'));
    wp_enqueue_style('loud-style');
});
