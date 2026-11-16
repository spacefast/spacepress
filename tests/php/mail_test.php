<?php

declare(strict_types=1);

/*
 * mail.send from "typedpress" on an in-process WordPress (tests/php/wp.php): the original EmailMessage
 * normalization, header and address safety, the transactional queue, wp_mail hand-off arguments,
 * the host transport filter and retries. Delivery is drained through Action Scheduler.
 */

use TypedPress\HttpError;
use TypedPress\JsObject;
use TypedPress\Mail;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
$schema['actions']['notify'] = ['input' => ['to' => ['type' => 'text', 'notNull' => true], 'fail' => ['type' => 'boolean']],
    'handler' => 'action__notify', 'access' => ['role' => 'anyone'], 'agents' => false, 'idempotent' => false, 'signature' => null];
$functions = file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php') . <<<'PHP'

    function action__notify(\TypedPress\JsObject $input, $ctx)
    {
        $queued = \TypedPress\Mail::send(new \TypedPress\JsObject(['to' => $input->p['to'], 'subject' => 'Hello', 'text' => 'plain', 'html' => '<p>rich</p>']));
        if (($input->p['fail'] ?? false) === true) {
            throw new \TypedPress\HttpError(409, 'rolled_back', 'after queueing');
        }
        return $queued->p['id'];
    }
    PHP;

$wp = wpSite('mail', ['schema' => $schema, 'functions' => $functions]);
// The in-process site answers on a dotless host, which is no sending domain; name one.
\TypedPress\Env::isolate(['TP_MAIL_SENDER_DOMAIN' => 'Example.Test']);
$jobs = static fn () => $wp->sql("SELECT `id`, `state`, `attempts`, `lastError` FROM {prefix}tp__jobs WHERE `job` = 'typedpress.mail' ORDER BY `createdAt`, `id`");
$drain = static fn () => ActionScheduler_QueueRunner::instance()->run('TypedPress tests');
$refusal = static function (mixed $message): string {
    try {
        Mail::payload($message);
        return 'ok';
    } catch (HttpError $e) {
        return $e->pointer . ' ' . $e->getMessage();
    }
};

// ---- normalization: the original runtime's emailPayload, field for field
eq('addresses coerce to { email, name? } lists and trim; text and html both travel',
    Mail::payload(['from' => ' app@example.test ', 'to' => 'a@example.test', 'subject' => 'S', 'text' => 't', 'html' => '<b>h</b>',
        'cc' => [['email' => 'c@example.test', 'name' => 'Cé']], 'replyTo' => 'r@example.test']),
    ['from' => ['email' => 'app@example.test'], 'to' => [['email' => 'a@example.test']], 'subject' => 'S', 'text' => 't', 'html' => '<b>h</b>',
        'cc' => [['email' => 'c@example.test', 'name' => 'Cé']], 'replyTo' => ['email' => 'r@example.test']]);
eq('bad messages are refused at send, with a pointer',
    array_map($refusal, [
        null,
        ['to' => 'a@example.test', 'text' => 'x'],
        ['to' => 'a@example.test', 'subject' => "two\r\nlines", 'text' => 'x'],
        ['to' => 'a@example.test', 'subject' => 'S'],
        ['to' => [], 'subject' => 'S', 'text' => 'x'],
        ['to' => 'not-an-address', 'subject' => 'S', 'text' => 'x'],
        ['to' => 'a,b@example.test', 'subject' => 'S', 'text' => 'x'],
        ['to' => ['email' => 'a@example.test', 'name' => "Evil\r\nBcc: x@example.test"], 'subject' => 'S', 'text' => 'x'],
        ['to' => 'a@example.test', 'subject' => 'S', 'text' => 'x', 'headers' => ['Bcc' => 'x@example.test']],
        ['to' => 'a@example.test', 'subject' => 'S', 'text' => 'x', 'headers' => ['X-Ok' => "v\nInjected: 1"]],
        ['to' => array_fill(0, 51, 'a@example.test'), 'subject' => 'S', 'text' => 'x'],
        ['to' => 'a@example.test', 'subject' => 'S', 'text' => 'x', 'attachments' => []],
    ]),
    [' A message object is required.', '/subject Message subject is required and must be one line.',
        '/subject Message subject is required and must be one line.', '/text Message must carry text, html, or both.',
        '/to At least one address is required.', '/to/0 Not a valid email address.', '/to/0 Not a valid email address.',
        '/to/0/name A display name is one line of UTF-8.', '/headers/Bcc Header Bcc is not a header a message may set.',
        '/headers/X-Ok Header X-Ok must be a single-line string.', '/to A message may have at most 50 recipients.',
        '/attachments Unknown message field attachments.']);
eq('wp_mail arguments: encoded display names, html with a text alternative, custom headers last',
    Mail::wpMailArguments(Mail::payload(['from' => ['email' => 'app@example.test', 'name' => 'TypedPress, Inc.'], 'to' => ['a@example.test'],
        'subject' => 'S', 'text' => 'alt', 'html' => '<p>h</p>', 'bcc' => ['b@example.test'], 'headers' => ['X-App' => 'first']])),
    ['to' => ['a@example.test'], 'subject' => 'S', 'message' => '<p>h</p>',
        'headers' => ['From: =?UTF-8?B?' . base64_encode('TypedPress, Inc.') . '?= <app@example.test>', 'Reply-To: =?UTF-8?B?' . base64_encode('TypedPress, Inc.') . '?= <app@example.test>',
            'Bcc: b@example.test', 'Content-Type: text/html; charset=UTF-8', 'X-App: first'],
        'alt' => 'alt']);
eq('from defaults to noreply@ the sending domain', Mail::payload(['to' => 'a@example.test', 'subject' => 'S', 'text' => 'x'])['from'],
    ['email' => 'noreply@example.test']);

// ---- transactional queue: a rollback sends nothing
$sent = [];
remove_all_filters('pre_wp_mail');
add_filter('pre_wp_mail', static function ($short, array $atts) use (&$sent) {
    $sent[] = $atts;
    return true;
}, 10, 2);
[$status] = $wp->handle('POST', '/actions/notify', json_encode(['to' => 'rolled@example.test', 'fail' => true]));
eq('a handler that throws after send queues nothing', [$status, count($jobs())], [409, 0]);
[$status, , $raw] = $wp->handle('POST', '/actions/notify', json_encode(['to' => 'ok@example.test']));
$id = json_decode($raw, true)['data'];
eq('send returns the queued delivery id and nothing is sent before the queue runs', [$status, $jobs()[0]['id'] === $id, $sent], [200, true, []]);
$drain();
eq('the queue hands the message to wp_mail once',
    [count($sent), $sent[0]['to'], $sent[0]['subject'], $sent[0]['message'], $jobs()[0]['state']],
    [1, ['ok@example.test'], 'Hello', '<p>rich</p>', 'done']);

// ---- one PHPMailer serves the whole queue run: a text alternative never carries over
// WordPress's own mailer; preSend() builds each message, nothing is sent.
remove_all_filters('pre_wp_mail');
$bodies = [];
add_action('phpmailer_init', static function ($mailer) use (&$bodies): void {
    $mailer->isSendmail();
    $mailer->Sendmail = '/bin/true';
}, PHP_INT_MIN);
add_action('phpmailer_init', static function ($mailer) use (&$bodies): void {
    $bodies[] = ['to' => array_keys($mailer->getAllRecipientAddresses())[0], 'alt' => $mailer->AltBody];
}, PHP_INT_MAX);
// The queued job input is the normalized message send() stores.
$rich = static fn (string $to) => ['message' => Mail::payload(['to' => $to, 'subject' => 'S', 'html' => '<p>rich</p>', 'text' => "private text for $to"])];
$plain = static fn (string $to) => ['message' => Mail::payload(['to' => $to, 'subject' => 'S', 'html' => '<p>html only</p>'])];
Mail::deliver($rich('first@example.test'), []);
Mail::deliver($plain('second@example.test'), []);
eq('a later html-only message does not inherit the previous message\'s text part', $bodies, [
    ['to' => 'first@example.test', 'alt' => 'private text for first@example.test'],
    ['to' => 'second@example.test', 'alt' => ''],
]);
global $phpmailer;
eq('the shared mailer is left as it was found', $phpmailer->AltBody, '');
remove_all_actions('phpmailer_init');
add_filter('pre_wp_mail', static function ($short, array $atts) use (&$sent) {
    $sent[] = $atts;
    return true;
}, 10, 2);

// ---- a host transport at priority 0 is still the transport (has_filter() answers 0)
$first = [];
add_filter('tp_mail_transport', static function ($accepted, array $payload) use (&$first) {
    $first[] = $payload['to'][0]['email'];
    return true;
}, 0, 2);
$sent = [];
Mail::deliver($plain('first@example.test'), []);
eq('a priority-0 transport receives the message and wp_mail is not used', [$first, $sent], [['first@example.test'], []]);
remove_all_filters('tp_mail_transport');

// ---- the host transport replaces wp_mail and a refusal is retried
$offered = [];
$accept = false;
add_filter('tp_mail_transport', static function ($accepted, array $payload) use (&$offered, &$accept) {
    $offered[] = $payload;
    return $accept;
}, 10, 2);
[, , $raw] = $wp->handle('POST', '/actions/notify', json_encode(['to' => 'host@example.test']));
$sent = [];
$drain();
$row = array_values(array_filter($jobs(), static fn ($j) => $j['id'] === json_decode($raw, true)['data']))[0];
eq('a refusing host transport fails the attempt for a retry, and wp_mail is never used',
    [count($offered), $offered[0]['to'], $row['state'], (int) $row['attempts'], str_contains((string) $row['lastError'], 'did not accept'), $sent],
    [1, [['email' => 'host@example.test']], 'failed', 1, true, []]);
$accept = true;
$wp->sql("UPDATE {prefix}tp__jobs SET `runAt` = '2000-01-01T00:00:00.000Z' WHERE `id` = ?", [$row['id']]);
\TypedPress\Jobs\Runner::run($row['id']);
eq('the retry reaches the host transport and completes', [count($offered), $wp->sql("SELECT `state` FROM {prefix}tp__jobs WHERE `id` = ?", [$row['id']])[0]['state']], [2, 'done']);

finish('mail');
