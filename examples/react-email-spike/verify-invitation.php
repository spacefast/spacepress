<?php

declare(strict_types=1);

use TypedPress\Identity\Organizations;
use TypedPress\Identity\Plugin;
use TypedPress\Identity\Security;

require __DIR__ . '/../../tests/php/wp.php';

wpSite('organization-invite', [
    'schema' => require $argv[1] . '/schema.php',
    'functions' => file_get_contents($argv[1] . '/functions.php'),
    'identity' => true,
]);

$value = (object) ['name' => 'Before'];
$child = \TypedPress\Html::component(static fn ($props): string => $props->name, $value);
$paragraph = \TypedPress\Render\Email::component('EmailText', null, $child);
$value->name = 'After';
assert(str_contains($paragraph->html(), '>After</p>'), 'email components render children when placed');

$request = static function (array $params): WP_REST_Request {
    $request = new WP_REST_Request('POST');
    $request->set_body_params($params);
    return $request;
};

$messages = [];
remove_all_filters("pre_wp_mail");
add_action('phpmailer_init', static function ($mailer) use (&$messages): void {
    $mailer->isSendmail();
    $mailer->Sendmail = '/usr/bin/true';
    $messages[] = [
        'to' => array_keys($mailer->getAllRecipientAddresses())[0],
        'subject' => $mailer->Subject,
        'body' => $mailer->Body,
        'text' => $mailer->AltBody,
        'type' => $mailer->ContentType,
    ];
}, PHP_INT_MAX);

$db = Plugin::$db;
$organizations = new Organizations($db, Plugin::$security, Plugin::$accounts);
$owner = Plugin::$accounts->emailLogin('owner@example.test');
$org = $organizations->handle('organizations', 'POST', $request([
    'name' => 'Email example',
    'idempotency_key' => Security::token(),
]), $owner);
$results = [];
foreach (['Example site', 'A & <B>'] as $index => $siteName) {
    update_option('blogname', $siteName);
    $email = "invitee-$index@example.test";
    $invitee = Plugin::$accounts->emailLogin($email);
    $sent = $organizations->handle('organizations/invite', 'POST', $request([
        'organization_id' => $org['id'],
        'email' => $email,
    ]), $owner);
    assert($sent['sent'] === true);
    $mail = $messages[$index];
    $siteName = get_bloginfo('name');
    assert($mail['to'] === $email && $mail['subject'] === 'Join your organization on ' . $siteName);
    $custom = $argv[2] === 'override';
    assert($mail['type'] === ($custom ? 'text/html' : 'text/plain'));
    assert(preg_match('/[0-9a-f]{32}\.[a-zA-Z0-9_-]+(?=\s|<)/', $custom ? $mail['text'] : $mail['body'], $match) === 1);
    $code = $match[0];
    assert(Plugin::$accounts->owner($email) === $invitee, 'recipient owns verified address');
    $challenge = $db->row(
        "SELECT payload FROM {$db->prefix}challenges WHERE id=%s AND purpose='invitation'",
        explode('.', $code, 2)[0],
    );
    assert($challenge !== null, 'the message contains an issued challenge ID');
    $joined = $organizations->handle('organizations/accept', 'POST', $request(['invitation' => $code]), $invitee);
    assert($joined['joined'] === true);
    if ($custom) {
        $results[] = [
            'props' => [
                'siteName' => $siteName,
                'identityUrl' => home_url('/identity'),
                'invitationCode' => $code,
                'expiresIn' => 'seven days',
            ],
            'html' => $mail['body'],
            'text' => $mail['text'],
        ];
    }
}
echo wp_json_encode($results);
