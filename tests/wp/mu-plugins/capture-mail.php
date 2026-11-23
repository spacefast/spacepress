<?php
// Test stack only: keep outgoing mail in the uploads dir instead of sending it, so suites can read
// sign-in codes (spacepress-identity, §6.2) without an SMTP server.
add_filter('pre_wp_mail', static function ($short, array $atts) {
    $dir = WP_CONTENT_DIR . '/spacepress-test-mail';
    wp_mkdir_p($dir);
    // Apache and WP-CLI share these disposable captures but can run as different users.
    if ((fileperms($dir) & 0777) !== 0777) {
        chmod($dir, 0777);
    }
    $to = is_array($atts['to']) ? implode(',', $atts['to']) : (string) $atts['to'];
    $path = $dir . '/' . sanitize_file_name($to) . '.txt';
    file_put_contents($path, (string) $atts['message']);
    if ((fileperms($path) & 0777) !== 0666) {
        chmod($path, 0666);
    }
    return true;
}, 10, 2);
