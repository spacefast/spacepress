<?php

declare(strict_types=1);

/*
 * Every read a first/app/ page can make runs as the visitor (issue #311): the fixture
 * tests/fixtures/page-reads, built by `typedpress build`, on WordPress with php -S. Prints one JSON
 * object: for each surface, the note titles a signed-out visitor and an editor see.
 *
 *   TP_WP_THEMES=1 php tests/php/page_reads.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('page-reads', ['wpContent' => $argv[1], 'users' => ['chief' => 'editor']]);
wp_set_current_user(1);
\TypedPress\db()->insert('notes', ['title' => 'Public one', 'slug' => 'public-one', 'status' => 'published']);
\TypedPress\db()->insert('notes', ['title' => 'Secret draft', 'slug' => 'secret-draft', 'status' => 'draft']);
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

// A browser session for the editor: the logged-in cookie and the REST nonce for that session.
$id = $site->userId('chief');
$expires = time() + 3600;
$token = WP_Session_Tokens::get_instance($id)->create($expires);
$logged = wp_generate_auth_cookie($id, $expires, 'logged_in', $token);
$_COOKIE[LOGGED_IN_COOKIE] = $logged;
wp_set_current_user($id);
$nonce = wp_create_nonce('wp_rest');
wp_set_current_user(0);
unset($_COOKIE[LOGGED_IN_COOKIE]);
$editor = ['Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode($logged)];

$titles = static fn (string $body): array => array_values(array_filter(['Public one', 'Secret draft'], static fn (string $t): bool => str_contains($body, $t)));
$out = [];
foreach (['anonymous' => [], 'editor' => $editor] as $who => $headers) {
    $home = fetch("$url/", headers: $headers);
    preg_match('#layout (\d+)#', $home['body'], $count);
    $call = static fn (string $name): array => fetch("$url/__tp/api/v1/actions/$name", 'POST', [...$headers, 'Content-Type: application/json', ...($who === 'editor' ? ["X-WP-Nonce: $nonce"] : [])], '{}');
    [$trusted, $visitor] = [$call('trustedTitles'), $call('visitorTitles')];
    $out[$who] = [
        'page' => $titles($home['body']),
        'page cache' => $home['headers']['cache-control'][0] ?? null,
        'layout' => (int) ($count[1] ?? -1),
        'kind api' => $titles(fetch("$url/kind/", headers: $headers)['body']),
        'twin' => $titles(fetch("$url/index.md", headers: $headers)['body']),
        'route' => $titles(fetch("$url/api/titles", headers: $headers)['body']),
        'action db' => [$trusted['status'], $titles($trusted['body'])],
        'action kind api' => [$visitor['status'], $titles($visitor['body'])],
    ];
}
// The anonymous page again after the editor's render: what a shared cache would hand out.
$out['anonymous after editor'] = $titles(fetch("$url/")['body']);
echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
$site->destroy();
