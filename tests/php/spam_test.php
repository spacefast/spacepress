<?php

declare(strict_types=1);

/*
 * Spam checks on an in-process WordPress (tests/php/wp.php). Akismet isn't a platform plugin: a site
 * gets it through Jetpack, and comment creates are spam-checked only while it has a key. Without a key
 * the app still mounts and the check fails open. With one (WPCOM_API_KEY, or Jetpack's connection),
 * Akismet's own code checks every create. Only Akismet's API endpoint is a local stand-in, which records
 * each comment-check request and answers that the comment is spam.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
// TypedPress closes comments on every kind that doesn't turn them on (Hardening::comments), so the target is
// the blog's posts collection with `comments: true`.
$schema['collections']['posts']['comments'] = true;
$wp = wpSite('spam', [
    'schema' => $schema,
    'functions' => file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php'),
    'akismet' => true,
    // Two commenters: core's flood check refuses a second comment from one author within 15 seconds.
    'users' => ['sub' => 'subscriber', 'sub2' => 'subscriber'],
]);

eq('the app mounted with Akismet active and no key', [$wp->plugin()->unavailable(), \TypedPress\Wp\Platform::problems(), class_exists('Akismet', false), (bool) \Akismet::get_api_key()], [null, [], true, false]);
eq('runtime.wp reports Akismet without spam checks', \TypedPress\Wp\Platform::versions()['akismet'], ['version' => AKISMET_VERSION, 'spamChecks' => false]);

/** @var list<array{url: string, body: array<string, string>}> */
$checks = [];
add_filter('pre_http_request', static function (mixed $pre, array $args, string $url) use (&$checks): mixed {
    if (parse_url($url, PHP_URL_HOST) !== \Akismet::API_HOST) {
        return $pre;
    }
    parse_str((string) $args['body'], $body);
    $checks[] = ['url' => $url, 'body' => $body];
    return ['headers' => [], 'body' => str_ends_with((string) parse_url($url, PHP_URL_PATH), '/comment-check') ? 'true' : 'valid', 'response' => ['code' => 200, 'message' => 'OK'], 'cookies' => [], 'filename' => null];
}, 10, 3);

$post = wp_insert_post(['post_type' => $schema['collections']['posts']['wp']['postType'], 'post_title' => 'Spam target', 'post_status' => 'publish', 'comment_status' => 'open'], true);
$comment = static function (string $content, string $as) use ($post, $wp): array {
    $wp->actAs($as);
    $request = new \WP_REST_Request('POST', '/wp/v2/comments');
    $request->set_body_params(['post' => $post, 'content' => $content]);
    $response = rest_do_request($request);
    wp_set_current_user(0);
    return [$response->get_status(), $response->get_data()];
};

[$status, $data] = $comment('Without a key nothing is checked.', 'sub');
eq('without a key a create is not spam-checked: no Akismet request, the comment is not spam', [$status, $checks, get_comment((int) $data['id'])->comment_approved !== 'spam'], [201, [], true]);

define('WPCOM_API_KEY', 'typedpress-test-akismet-key');
eq('with WPCOM_API_KEY, runtime.wp reports spam checks on', \TypedPress\Wp\Platform::versions()['akismet']['spamChecks'], true);
[$status, $data] = $comment('Buy cheap things now.', 'sub2');
$check = array_values(array_filter($checks, static fn (array $c): bool => str_ends_with((string) parse_url($c['url'], PHP_URL_PATH), '/comment-check')));
eq('with a key a create is spam-checked with that key and the comment', [count($check), $check[0]['body']['api_key'] ?? null, $check[0]['body']['comment_content'] ?? null], [1, 'typedpress-test-akismet-key', 'Buy cheap things now.']);
eq('Akismet\'s spam answer marks the comment spam', [$status, get_comment((int) $data['id'])->comment_approved], [201, 'spam']);

// ---- Services forms: Akismet's comment-check before a submission is written ---------------------------------------
// Answered as Akismet documents its test values: an author or email of `akismet-guaranteed-spam` is spam,
// anything else is not (https://akismet.com/developers/detailed-docs/testing/). After the comment stand-in
// above, which records each request in $checks and calls everything spam.
add_filter('pre_http_request', static function (mixed $pre, array $args, string $url): mixed {
    if (parse_url($url, PHP_URL_HOST) !== \Akismet::API_HOST || !str_ends_with((string) parse_url($url, PHP_URL_PATH), '/comment-check')) {
        return $pre;
    }
    parse_str((string) $args['body'], $body);
    if (($body['comment_type'] ?? '') !== 'contact-form') {
        return $pre;
    }
    $spam = ($body['comment_author'] ?? '') === 'akismet-guaranteed-spam' || ($body['comment_author_email'] ?? '') === 'akismet-guaranteed-spam@example.com';
    return ['headers' => [], 'body' => $spam ? 'true' : 'false', 'response' => ['code' => 200, 'message' => 'OK'], 'cookies' => [], 'filename' => null];
}, 20, 3);
$formFields = ['name' => ['type' => 'text', 'notNull' => true], 'email' => ['type' => 'email', 'notNull' => true], 'message' => ['type' => 'text', 'notNull' => true]];
add_filter('tp_services_config', static fn (): array => ['forms' => [
    'contact' => ['fields' => $formFields, 'recipientEnv' => 'TP_SERVICES_MAIL_TO', 'senderEnv' => 'TP_SERVICES_MAIL_FROM', 'limit' => 100],
    'tight' => ['fields' => $formFields, 'recipientEnv' => 'TP_SERVICES_MAIL_TO', 'senderEnv' => 'TP_SERVICES_MAIL_FROM', 'limit' => 2],
]]);
putenv('TP_SERVICES_RATE_SECRET=' . bin2hex(random_bytes(32)));
$_SERVER['REMOTE_ADDR'] = '203.0.113.7';
$submissions = static fn (): int => (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}tp__services_submissions');
$jobs = static fn (): int => (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}tp__jobs');
$submit = static fn (array $data, string $key, string $form = 'contact'): array => $wp->call('POST', "/services/forms/$form", ['website' => '', 'data' => $data], headers: ['Idempotency-Key' => $key]);
$formChecks = static function () use (&$checks): array {
    return array_values(array_filter($checks, static fn (array $c): bool => ($c['body']['comment_type'] ?? '') === 'contact-form'));
};

[$status, $body] = $submit(['name' => 'akismet-guaranteed-spam', 'email' => 'spammer@example.test', 'message' => 'Cheap things.'], 'form-spam');
eq('a submission Akismet calls spam is refused, and no submission or mail job is written', [$status, $body['code'] ?? null, $submissions(), $jobs()], [422, 'spam', 0, 0]);
[$status] = $submit(['name' => 'akismet-guaranteed-spam', 'email' => 'spammer@example.test', 'message' => 'Cheap things.'], 'form-spam');
eq('its retry gets the same answer without asking Akismet again', [$status, count($formChecks())], [422, 1]);
$asked = $formChecks()[0]['body'] ?? [];
eq('the check is a contact-form comment: the author, email, text, the visitor\'s address and the key',
    [$asked['comment_type'] ?? null, $asked['comment_author'] ?? null, $asked['comment_author_email'] ?? null, $asked['comment_content'] ?? null, $asked['user_ip'] ?? null, $asked['api_key'] ?? null],
    ['contact-form', 'akismet-guaranteed-spam', 'spammer@example.test', 'Cheap things.', '203.0.113.7', 'typedpress-test-akismet-key']);
[$status] = $submit(['name' => 'Visitor', 'email' => 'akismet-guaranteed-spam@example.com', 'message' => 'Hello.'], 'form-spam-email');
eq('Akismet\'s spam email test value is refused too', [$status, $submissions()], [422, 0]);
[$status, $body] = $submit(['name' => 'Visitor', 'email' => 'visitor@example.test', 'message' => 'A real question.'], 'form-ham');
eq('a submission Akismet passes is saved', [$status, $body['delivery'] ?? null, $submissions(), count($formChecks())], [201, 'queued', 1, 3]);
add_filter('pre_http_request', static fn (mixed $pre, array $args, string $url): mixed => parse_url($url, PHP_URL_HOST) === \Akismet::API_HOST ? new \WP_Error('http_request_failed', 'unreachable') : $pre, 30, 3);
[$status] = $submit(['name' => 'akismet-guaranteed-spam', 'email' => 'visitor@example.test', 'message' => 'While Akismet is down.'], 'form-down');
eq('an unreachable Akismet fails open: the submission is saved', [$status, $submissions()], [201, 2]);
remove_all_filters('pre_http_request', 30);
$before = count($formChecks());
[$status] = $submit(['name' => 'akismet-guaranteed-spam', 'email' => 'visitor@example.test', 'message' => 'While Akismet is down.'], 'form-down');
eq('a retry of that accepted submission, once Akismet is back and would call it spam, replays its receipt', [$status, $submissions(), count($formChecks())], [201, 2, $before]);
// Refused submissions use the rate window too: two spam attempts fill a window of two.
$spam = ['name' => 'akismet-guaranteed-spam', 'email' => 'spammer@example.test', 'message' => 'Again.'];
$tight = [$submit($spam, 'tight-1', 'tight')[0], $submit($spam, 'tight-2', 'tight')[0], $submit(['name' => 'Visitor', 'email' => 'visitor@example.test', 'message' => 'Hi.'], 'tight-3', 'tight')[0]];
eq('spam answers count against the rate window: the third submission is limited before Akismet is asked', [$tight, count($formChecks())], [[422, 422, 429], $before + 2]);

finish('spam_test');
