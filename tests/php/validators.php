<?php

declare(strict_types=1);

/*
 * HTTP validators (tests/validators.rs): a prebuilt page (tests/fixtures/app-prebuilt) and the
 * OpenAPI document send an ETag and answer a matching If-None-Match with an empty 304, as public
 * files do; the facade's API reads keep `private, no-store` and no validator. On WordPress-on-SQLite
 * served by php -S with the theme front end on. Prints JSON.
 *
 *   TP_WP_THEMES=1 php tests/php/validators.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('validators', ['wpContent' => $argv[1], 'users' => ['chief' => 'editor']]);
wp_set_current_user(1);
\TypedPress\db()->insert('notes', ['title' => 'Hello', 'slug' => 'hello', 'status' => 'published']);
$site->actAs(null);
\TypedPress\Wp\Purges::flush();
$site->startServer();
$url = $site->url();

function fetch(string $url, array $headers = [], string $method = 'GET'): array
{
    $ch = curl_init($url);
    $out = [];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_HTTPHEADER => $headers, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_NOBODY => $method === 'HEAD',
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$out): int {
            if (str_contains($line, ':')) {
                [$name, $value] = explode(':', $line, 2);
                $out[strtolower(trim($name))][] = trim($value);
            }
            return strlen($line);
        },
    ]);
    $body = (string) curl_exec($ch);

    return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'prebuilt' => isset($out['x-typedpress-prebuilt']), 'etag' => $out['etag'][0] ?? null,
        'cache' => $out['cache-control'][0] ?? null, 'vary' => $out['vary'][0] ?? null, 'type' => $out['content-type'][0] ?? null, 'body' => $body];
}
$cookie = 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode(wp_generate_auth_cookie($site->userId('chief'), time() + 3600, 'logged_in'));
/** One URL's validator: [ETag well formed, its 304s (itself, weak, in a list, `*`) as [status, body empty], another tag's status]. */
$validated = static function (string $page, array $first) use ($url): array {
    $etag = (string) $first['etag'];
    $again = static fn (string $match): array => fetch("$url$page", ["If-None-Match: $match"]);

    return [
        preg_match('/^"[0-9a-f]+-[0-9a-f]+"$|^"[0-9a-f]{16,}"$/', $etag) === 1,
        array_map(static fn (array $r): array => [$r['status'], $r['body'] === '', $r['etag'] === $etag], [$again($etag), $again("W/$etag"), $again("\"x\", $etag"), $again('*')]),
        $again('"other"')['status'],
    ];
};

$out = [];
// ---- prebuilt pages -----------------------------------------------------------------------------
for ($i = 0; $i < 10 && as_has_scheduled_action(\TypedPress\Render\Prebuilt::ACTION, null, 'typedpress'); $i++) {
    ActionScheduler_QueueRunner::instance()->run('TypedPress tests');
}
$about = fetch("$url/about");
$twin = fetch("$url/about.md");
$out['prebuilt'] = [$about['status'], $about['prebuilt'], $twin['prebuilt']];
$out['prebuilt validators'] = $validated('/about', $about);
$out['prebuilt twin has its own'] = $twin['etag'] !== null && $twin['etag'] !== $about['etag'];
$out['prebuilt 304 keeps the cache policy'] = fetch("$url/about", ['If-None-Match: ' . $about['etag']])['cache'] === $about['cache'];
// A signed-in visitor isn't served the file, so isn't answered from its validator.
$out['prebuilt signed in'] = [fetch("$url/about", [$cookie, 'If-None-Match: ' . $about['etag']])['status'], fetch("$url/about", [$cookie])['prebuilt']];
// A HEAD gets the same validator.
$out['prebuilt head'] = fetch("$url/about", [], 'HEAD')['etag'] === $about['etag'];
// The validator is the bytes served: another content of the same length, with the same modification
// time, is a 200 with the new body for a client holding the old tag (review 1, B5).
$aboutFile = \TypedPress\Render\Prebuilt::dir() . '/about.html';
clearstatcache();
$mtime = filemtime($aboutFile);
$changed = substr_replace($about['body'], 'ABOUT', (int) strpos($about['body'], 'About'), 5);
file_put_contents($aboutFile, $changed);
touch($aboutFile, $mtime);
clearstatcache();
$replaced = fetch("$url/about", ['If-None-Match: ' . $about['etag']]);
$out['prebuilt same size and mtime'] = [strlen($changed) === strlen($about['body']), filemtime($aboutFile) === $mtime, $replaced['status'], $replaced['body'] === $changed, $replaced['etag'] !== $about['etag']];

// ---- the OpenAPI document --------------------------------------------------------------------------
$doc = fetch("$url/__tp/api/v1/openapi.json");
$decoded = json_decode($doc['body'], true);
$out['openapi'] = [$doc['status'], $doc['type'], $doc['cache'], $decoded['servers'][0]['url'] ?? null, isset($decoded['paths']), $decoded['openapi'] ?? null];
$out['openapi validators'] = $validated('/__tp/api/v1/openapi.json', $doc);
// The document's server is this site: another site name gives another body and another ETag.
update_option('blogname', 'Renamed');
$renamed = fetch("$url/__tp/api/v1/openapi.json");
$out['openapi follows the site'] = [$renamed['etag'] !== $doc['etag'], json_decode($renamed['body'], true)['servers'][0]['description'] ?? null];
// The bytes as before: the built file, its `servers` replaced, re-encoded (empty schemas stay objects).
$file = json_decode((string) file_get_contents($site->plugin()->dir . '/tp/app/openapi.json'), false);
$file->servers = [['url' => \TypedPress\Wp\Facade::url(), 'description' => 'Renamed']];
$out['openapi bytes'] = $renamed['body'] === json_encode($file, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
// The same document bytes with another modification time keep their tag; other bytes of the same
// length and time get another (review 1, B5).
$built = $site->plugin()->dir . '/tp/app/openapi.json';
touch($built, filemtime($built) + 3600);
clearstatcache();
$touched = fetch("$url/__tp/api/v1/openapi.json");
$bytes = (string) file_get_contents($built);
clearstatcache();
$builtTime = filemtime($built);
file_put_contents($built, str_replace('"openapi": "3.1.0"', '"openapi": "3.1.1"', $bytes));
touch($built, $builtTime);
clearstatcache();
$edited = fetch("$url/__tp/api/v1/openapi.json", ['If-None-Match: ' . $touched['etag']]);
file_put_contents($built, $bytes);
$out['openapi tag follows the bytes'] = [$touched['etag'] === $renamed['etag'], $edited['status'], json_decode($edited['body'], true)['openapi'] ?? null, $edited['etag'] !== $touched['etag']];

// ---- the facade's reads stay private -----------------------------------------------------------------
$list = fetch("$url/__tp/api/v1/notes");
$out['facade'] = [$list['status'], $list['cache'], $list['etag'], fetch("$url/__tp/api/v1/notes", ['If-None-Match: *'])['status']];

$site->stopServer();
echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
