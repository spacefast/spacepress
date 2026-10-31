<?php
// Test stack only: keep outgoing mail in the uploads dir instead of sending it, so suites can read
// sign-in codes (wp zero-identity, §6.2) without an SMTP server.
add_filter('pre_wp_mail', static function ($short, array $atts) {
    $dir = WP_CONTENT_DIR . '/zero-test-mail';
    wp_mkdir_p($dir);
    $to = is_array($atts['to']) ? implode(',', $atts['to']) : (string) $atts['to'];
    file_put_contents($dir . '/' . sanitize_file_name($to) . '.txt', (string) $atts['message']);
    return true;
}, 10, 2);
