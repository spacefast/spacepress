<?php

declare(strict_types=1);

/*
 * Forms without JavaScript (docs/spec/rendering.md §4.2): tests/fixtures/forms, built by
 * `typedpress build`, on WordPress with php -S. Each step is what a browser with scripts off does: GET
 * the page, POST the form as `application/x-www-form-urlencoded` to its `action`, follow the 303
 * with the cookie it set. Prints one JSON object of what each step saw.
 *
 *   TP_WP_THEMES=1 php tests/php/forms.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('forms', ['wpContent' => $argv[1], 'users' => ['reader' => 'subscriber']]);
$site->actAs(null);
$site->startServer();
$url = $site->url();

function fetch(string $url, string $method = 'GET', array $headers = [], ?string $body = null): array
{
    $ch = curl_init($url);
    $out = [];
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => $headers, CURLOPT_POSTFIELDS => $body,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$out): int {
            if (str_contains($line, ':')) {
                [$name, $value] = explode(':', $line, 2);
                $out[strtolower(trim($name))][] = trim($value);
            }
            return strlen($line);
        },
    ]);
    $text = (string) curl_exec($ch);
    return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'headers' => $out, 'body' => $text];
}

/** The form with class $class on $html: its action, method and fields (hidden ones with values). */
function form(string $html, string $class): array
{
    $doc = new DOMDocument();
    @$doc->loadHTML($html);
    foreach ($doc->getElementsByTagName('form') as $form) {
        if ($form->getAttribute('class') !== $class) {
            continue;
        }
        $fields = [];
        foreach ($form->getElementsByTagName('input') as $input) {
            $fields[] = [$input->getAttribute('name'), $input->getAttribute('type'), $input->getAttribute('value')];
        }
        return ['action' => $form->getAttribute('action'), 'method' => $form->getAttribute('method'), 'fields' => $fields];
    }
    throw new RuntimeException("no form .$class");
}

/** The text of the first element with class $class, or null. */
function text(string $html, string $class): ?string
{
    $doc = new DOMDocument();
    @$doc->loadHTML($html);
    foreach ((new DOMXPath($doc))->query("//*[@class='$class']") as $node) {
        return trim($node->textContent);
    }
    return null;
}

/**
 * Submits $form as a browser does: its hidden fields, then $values, form-encoded, to its action.
 * Follows the 303 with the cookie it set, as the browser does, and returns both responses.
 */
function submit(array $form, array $values, array $headers = []): array
{
    $pairs = [];
    foreach ($form['fields'] as [$name, $type, $value]) {
        if ($type === 'hidden') {
            $pairs[] = rawurlencode($name) . '=' . rawurlencode($value);
        }
    }
    foreach ($values as $name => $value) {
        $pairs[] = rawurlencode($name) . '=' . rawurlencode((string) $value);
    }
    $post = fetch($form['action'], 'POST', [...$headers, 'Content-Type: application/x-www-form-urlencoded'], implode('&', $pairs));
    $location = $post['headers']['location'][0] ?? null;
    $cookie = explode(';', $post['headers']['set-cookie'][0] ?? '')[0];
    $back = $location === null ? null : fetch($location, headers: [...$headers, ...($cookie === '' ? [] : ["Cookie: $cookie"])]);

    return ['post' => $post, 'location' => $location, 'cookie' => $cookie, 'back' => $back];
}

$out = [];
$page = fetch("$url/?ref=nav");
$subscribe = form($page['body'], 'subscribe');
$out['form'] = [
    'method' => $subscribe['method'],
    'action' => parse_url($subscribe['action'], PHP_URL_PATH),
    'hidden' => array_values(array_filter($subscribe['fields'], static fn ($f) => $f[1] === 'hidden')),
    'page cache' => $page['headers']['cache-control'][0] ?? null,
];

// Success: the action's result comes back on the page; the redirect goes to the page it came from.
$ok = submit($subscribe, ['email' => 'ada@example.test', 'seats' => '3', 'weekly' => 'on', 'note' => '']);
$out['success'] = [
    'status' => $ok['post']['status'],
    'location' => preg_replace('/_flash=[0-9a-f]{12}/', '_flash=ID', (string) parse_url((string) $ok['location'], PHP_URL_PATH) . '?' . parse_url((string) $ok['location'], PHP_URL_QUERY)),
    'cookie flags' => array_slice(array_map('trim', explode(';', $ok['post']['headers']['set-cookie'][0] ?? '')), 1),
    'done' => text($ok['back']['body'], 'done'),
    'back cache' => $ok['back']['headers']['cache-control'][0] ?? null,
    'cookie cleared' => str_contains(implode("\n", $ok['back']['headers']['set-cookie'] ?? []), 'Max-Age=0'),
];
// Read once: the same URL again shows nothing (the browser dropped the cookie).
$again = fetch((string) $ok['location']);
$out['success']['again'] = text($again['body'], 'done');
// A forged or foreign cookie is no flash.
$forged = fetch((string) $ok['location'], headers: ['Cookie: ' . explode('=', $ok['cookie'], 2)[0] . '=AAAA' . substr(explode('=', $ok['cookie'], 2)[1], 4)]);
$out['success']['forged'] = text($forged['body'], 'done');
// Unchecked checkbox: false.
$off = submit($subscribe, ['email' => 'bo@example.test', 'seats' => '1']);
$out['unchecked'] = text($off['back']['body'], 'done');

// A field the input refuses: the error names it, the page fills the form again.
$bad = submit($subscribe, ['email' => 'not an email', 'seats' => '2']);
$out['invalid'] = [
    'status' => $bad['post']['status'],
    'error' => text($bad['back']['body'], 'error'),
    'field' => text($bad['back']['body'], 'field-error'),
    'refilled' => form($bad['back']['body'], 'subscribe')['fields'][0][2] ?? null,
    'seats refilled' => array_values(array_filter(form($bad['back']['body'], 'subscribe')['fields'], static fn ($f) => $f[0] === 'seats'))[0][2] ?? null,
];
// A password the visitor typed is never sent back to fill the form (here, a field the action
// doesn't take, refused as unknown).
$secret = submit($subscribe, ['email' => 'p@example.test', 'seats' => '1', 'password' => 'hunter2']);
$out['password'] = [
    text($secret['back']['body'], 'error'),
    array_values(array_filter(form($secret['back']['body'], 'subscribe')['fields'], static fn ($f) => $f[0] === 'password'))[0][2] ?? null,
    form($secret['back']['body'], 'subscribe')['fields'][0][2] ?? null,
];
// The handler's own HttpError, and a number that isn't one.
$out['handler error'] = text(submit($subscribe, ['email' => 'c@example.test', 'seats' => '9'])['back']['body'], 'error');
$out['not a number'] = text(submit($subscribe, ['email' => 'c@example.test', 'seats' => 'lots'])['back']['body'], 'error');

// The return path is a path on this site, never another host.
$evil = $subscribe;
$evil['fields'] = array_map(static fn ($f) => $f[0] === '_tp_return' ? [$f[0], $f[1], '//evil.example/x'] : $f, $evil['fields']);
$out['open redirect'] = parse_url((string) submit($evil, ['email' => 'd@example.test', 'seats' => '1'])['location'], PHP_URL_HOST) === parse_url($url, PHP_URL_HOST);

// A cross-site form post is refused before the action runs.
$cross = submit($subscribe, ['email' => 'e@example.test', 'seats' => '1'], ['Origin: https://evil.example']);
$out['cross site'] = [$cross['post']['status'], text($cross['back']['body'], 'error'), text($cross['back']['body'], 'done')];

// A JSON call to the same URL is unchanged: `{ data }`, no redirect.
$json = fetch($subscribe['action'], 'POST', ['Content-Type: application/json'], '{"email":"f@example.test","seats":1,"weekly":false}');
$out['json'] = [$json['status'], json_decode($json['body'], true)['data']['seats'] ?? null];

// An action the visitor may not run: the refusal comes back to the page.
$members = form($page['body'], 'members');
$denied = submit($members, ['name' => 'Ann']);
$out['signed out'] = [text($denied['back']['body'], 'member-error'), text($denied['back']['body'], 'member')];

// Signed in: the page carries the REST nonce (and isn't shared), the action runs as the user.
$id = $site->userId('reader');
$expires = time() + 3600;
$token = WP_Session_Tokens::get_instance($id)->create($expires);
$logged = wp_generate_auth_cookie($id, $expires, 'logged_in', $token);
$session = ['Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode($logged)];
$mine = fetch("$url/", headers: $session);
$members = form($mine['body'], 'members');
$signed = submit($members, ['name' => 'Ann'], $session);
// The browser sends both cookies on the way back.
$back = fetch((string) $signed['location'], headers: ['Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode($logged) . '; ' . $signed['cookie']]);
$out['signed in'] = [
    'nonce' => in_array('_wpnonce', array_column($members['fields'], 0), true),
    'page cache' => $mine['headers']['cache-control'][0] ?? null,
    'member' => text($back['body'], 'member'),
    'user' => $id,
];
// Without the nonce a signed-in cookie isn't the user: the action runs signed out and is refused.
$members['fields'] = array_values(array_filter($members['fields'], static fn ($f) => $f[0] !== '_wpnonce'));
$nn = submit($members, ['name' => 'Ann'], $session);
$nnBack = fetch((string) $nn['location'], headers: ['Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode($logged) . '; ' . $nn['cookie']]);
$out['no nonce'] = [$nn['post']['status'], text($nnBack['body'], 'member-error'), text($nnBack['body'], 'member')];

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
$site->destroy();
