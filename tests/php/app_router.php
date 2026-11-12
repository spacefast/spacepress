<?php

declare(strict_types=1);

/*
 * `first/app/` on WordPress over HTTP (tests/compiler.rs `app_router_serves_pages_on_wordpress`):
 * the fixture tests/fixtures/app-router, built by `first build`, installed with every plugin active
 * and served by php -S with the theme front end on. Prints one JSON object: label => observed.
 *
 *   FIRST_WP_THEMES=1 php tests/php/app_router.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('app', ['wpContent' => $argv[1], 'users' => ['reader' => 'subscriber', 'chief' => 'editor']]);
wp_set_current_user(1);
\First\db()->insert('notes', ['title' => 'Hello', 'slug' => 'hello', 'secret' => 'desk only', 'status' => 'published']);
\First\db()->insert('notes', ['title' => 'Draft', 'slug' => 'draft', 'status' => 'draft']);
$site->actAs(null);
$site->startServer();
$url = $site->url();

function fetch(string $url, string $method = 'GET', array $headers = [], ?string $body = null): array
{
    $ch = curl_init($url);
    $out = [];
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method, CURLOPT_NOBODY => $method === 'HEAD', CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
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

/** The router region's contents and the document title. */
function page(array $r): array
{
    preg_match('#<title>(.*?)</title>#s', $r['body'], $t);
    preg_match('#data-wp-router-region="first/main">(.*)</div>\n#s', $r['body'], $m);
    return ['status' => $r['status'], 'title' => html_entity_decode($t[1] ?? '', ENT_QUOTES), 'body' => $m[1] ?? null];
}

$cookie = static function (string $user) use ($site): string {
    $id = $site->userId($user);
    $expires = time() + 3600;
    return 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode(wp_generate_auth_cookie($id, $expires, 'logged_in'));
};

$home = fetch("$url/");
$out = [
    'home' => page($home),
    'home description' => str_contains($home['body'], '<meta name="description" content="Notes.">'),
    'home cache' => $home['headers']['cache-control'] ?? null,
    'router module' => str_contains($home['body'], 'first/Render/client/router.js'),
    'note' => page(fetch("$url/notes/hello")),
    'note canonical' => (bool) preg_match('#<link rel="canonical" href="' . preg_quote($url, '#') . '/notes/hello">#', fetch("$url/notes/hello")['body']),
    'note as editor' => page(fetch("$url/notes/hello", headers: [$cookie('chief')])),
    'draft' => page(fetch("$url/notes/draft")),
    'missing' => page(fetch("$url/notes/nope")),
    'unrouted' => page(fetch("$url/no/such/page")),
    'search' => page(fetch("$url/notes?page=3&q=tea")),
    'search defaults' => page(fetch("$url/notes?page=abc")),
    'search noindex' => str_contains(fetch("$url/notes")['body'], 'noindex'),
    'group' => page(fetch("$url/about")),
    'docs index' => page(fetch("$url/docs")),
    'docs deep' => page(fetch("$url/docs/a/b")),
    'guard anonymous' => [fetch("$url/account")['status'], str_contains((fetch("$url/account")['headers']['location'][0] ?? ''), 'wp-login.php')],
    'guard subscriber' => page(fetch("$url/account", headers: [$cookie('reader')])),
    'broken' => page(fetch("$url/broken")),
    'api' => [fetch("$url/api/notes")['status'], fetch("$url/api/notes")['body']],
    'api method' => fetch("$url/api/notes", 'DELETE')['status'],
    'page POST' => [fetch("$url/notes/hello", 'POST', ['Content-Type: application/x-www-form-urlencoded'], 'x=1')['status'], fetch("$url/notes/hello", 'POST', [], 'x=1')['headers']['location'][0] ?? null],
    'HEAD' => [fetch("$url/", 'HEAD')['status'], fetch("$url/", 'HEAD')['body']],
    // php -S runs WordPress for every path, so wp-admin and wp-login.php are the browser suite's
    // (tests/wp); here the router must leave REST, feeds and reserved paths to WordPress.
    'rest' => fetch("$url/wp-json/")['status'],
    'feed' => fetch("$url/feed/")['status'],
    'reserved' => str_contains(fetch("$url/wp-content/nothing-here")['body'], 'No such page'),
];
echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), "\n";
$site->destroy();
