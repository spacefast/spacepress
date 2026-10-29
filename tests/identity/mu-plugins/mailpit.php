<?php
// Test stack only: deliver wp_mail through the Mailpit service so suites can read codes.
add_action('phpmailer_init', static function ($mailer): void {
    $mailer->isSMTP();
    $mailer->Host = 'mailpit';
    $mailer->Port = 1025;
    $mailer->SMTPAuth = false;
    $mailer->SMTPAutoTLS = false;
});
