<?php

declare(strict_types=1);

/*
 * HTTP validators (tests/validators.rs): a prebuilt page (tests/fixtures/app-prebuilt) and the
 * OpenAPI document send an ETag and answer a matching If-None-Match with an empty 304, as public
 * files do; the facade's API reads keep `private, no-store` and no validator. On WordPress-on-SQLite
 * served by php -S with the theme front end on. Prints JSON.
 *
 *   SP_WP_THEMES=1 php tests/php/validators.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

// `X-Swap: replace` / `X-Swap: unreadable` (review 2, R1): the prebuilt directory is a stream wrapper
// whose file exists with a fresh mtime and whose content changes on every open (OLD on the first,
// NEW after), or which can't be opened at all. Deterministic: no timing, no real file replaced.
$swap = <<<'PHP'
    <?php
    if (!isset($_SERVER['HTTP_X_SWAP'])) {
        return;
    }
    final class SpSwapStream
    {
        public static int $opens = 0;
        public $context;
        private string $data = '';
        private int $at = 0;
        public function url_stat(string $path, int $flags): array
        {
            return ['size' => 8, 'mtime' => time(), 'mode' => 0100644];
        }
        public static int $reads = 0;
        public function stream_open(string $path, string $mode): bool
        {
            if ($_SERVER['HTTP_X_SWAP'] === 'unreadable') {
                return false;
            }
            if ($_SERVER['HTTP_X_SWAP'] === 'short') {
                $this->data = 'OLD'; // stat says 8 bytes, the stream ends after 3
                return true;
            }
            $this->data = self::$opens++ === 0 ? 'OLD-BODY' : 'NEW-BODY';
            return true;
        }
        public function stream_read(int $n): string|false
        {
            if ($_SERVER['HTTP_X_SWAP'] === 'empty-read') {
                // Nothing, and never at the end. Capped, so a reader that doesn't stop fails the
                // request instead of hanging the suite.
                if (++self::$reads > 1000) {
                    throw new RuntimeException('the prebuilt reader read an empty stream 1000 times');
                }
                return '';
            }
            $out = substr($this->data, $this->at, $n);
            $this->at += strlen($out);
            return $out;
        }
        public function stream_eof(): bool
        {
            return $_SERVER['HTTP_X_SWAP'] !== 'empty-read' && $this->at >= strlen($this->data);
        }
        public function stream_stat(): array
        {
            $size = in_array($_SERVER['HTTP_X_SWAP'], ['short', 'empty-read'], true) ? 8 : strlen($this->data);
            return ['size' => $size, 'mtime' => time(), 'mode' => 0100644];
        }
        public function stream_seek(int $offset, int $whence): bool
        {
            $this->at = $offset;
            return true;
        }
        public function stream_tell(): int
        {
            return $this->at;
        }
    }
    if ($_SERVER['HTTP_X_SWAP'] === 'large') {
        // A page larger than what this request has left: just before the file is read, the limit is
        // set to the memory in use plus 2 MiB, less than the 8 MiB page, so holding it whole is fatal.
        add_filter('sp_prebuilt_serve', static function (bool $serve): bool {
            ini_set('memory_limit', (string) (memory_get_usage(true) + 2 * 1024 * 1024));
            return $serve;
        }, PHP_INT_MAX);
        return;
    }
    stream_wrapper_register('spswap', SpSwapStream::class);
    add_filter('sp_prebuilt_dir', static fn (): string => 'spswap://prebuilt');
    PHP;
$site = wpSite('validators', ['wpContent' => $argv[1], 'users' => ['chief' => 'editor'], 'muPlugins' => ['swap' => $swap]]);
wp_set_current_user(1);
\SpacePress\db()->insert('notes', ['title' => 'Hello', 'slug' => 'hello', 'status' => 'published']);
$site->actAs(null);
\SpacePress\Wp\Purges::flush();
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

    return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'prebuilt' => isset($out['x-spacepress-prebuilt']), 'etag' => $out['etag'][0] ?? null,
        'cache' => $out['cache-control'][0] ?? null, 'vary' => $out['vary'][0] ?? null, 'type' => $out['content-type'][0] ?? null, 'body' => $body];
}
$cookie = 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode(wp_generate_auth_cookie($site->userId('chief'), time() + 3600, 'logged_in'));
/**
 * One URL's validator: [ETag well formed, its 304s (itself, weak, in a list, a list with an empty
 * element, `*`) as [status, body empty], the status for headers that don't name it: another tag; one
 * quoted tag holding a comma and a `*` (a comma inside the quotes separates nothing); and fields that
 * are not a list of tags although this ETag is in them (a lowercase `w/`, two tags with no comma,
 * text after the tag, `*` beside a tag)].
 */
$validated = static function (string $page, array $first) use ($url): array {
    $etag = (string) $first['etag'];
    $again = static fn (string $match): array => fetch("$url$page", ["If-None-Match: $match"]);

    return [
        preg_match('/^"[0-9a-f]+-[0-9a-f]+"$|^"[0-9a-f]{16,}"$/', $etag) === 1,
        array_map(static fn (array $r): array => [$r['status'], $r['body'] === '', $r['etag'] === $etag], [$again($etag), $again("W/$etag"), $again("\"x\", $etag"), $again("\"x\",, $etag ,"), $again('*')]),
        array_map(static fn (string $match): int => $again($match)['status'], ['"other"', '"a,*,b"', "w/$etag", "\"x\" $etag", "{$etag}x", "*, $etag"]),
    ];
};

$out = [];
// ---- prebuilt pages -----------------------------------------------------------------------------
for ($i = 0; $i < 10 && as_has_scheduled_action(\SpacePress\Render\Prebuilt::ACTION, null, 'spacepress'); $i++) {
    ActionScheduler_QueueRunner::instance()->run('SpacePress tests');
}
$about = fetch("$url/about/");
$twin = fetch("$url/about.md");
$out['prebuilt'] = [$about['status'], $about['prebuilt'], $twin['prebuilt']];
$out['prebuilt validators'] = $validated('/about/', $about);
$out['prebuilt twin has its own'] = $twin['etag'] !== null && $twin['etag'] !== $about['etag'];
$out['prebuilt 304 keeps the cache policy'] = fetch("$url/about/", ['If-None-Match: ' . $about['etag']])['cache'] === $about['cache'];
// A signed-in visitor isn't served the file, so isn't answered from its validator.
$out['prebuilt signed in'] = [fetch("$url/about/", [$cookie, 'If-None-Match: ' . $about['etag']])['status'], fetch("$url/about/", [$cookie])['prebuilt']];
// A HEAD gets the same validator.
$out['prebuilt head'] = fetch("$url/about/", [], 'HEAD')['etag'] === $about['etag'];
// Replaced between the tag and the body: whatever body is sent, the tag sent names exactly it.
$swapped = fetch("$url/about/", ['X-Swap: replace']);
$out['prebuilt replaced between reads'] = [$swapped['status'], $swapped['prebuilt'], $swapped['body'], $swapped['etag'] === \SpacePress\Validator::bytes($swapped['body'])];
// A file that exists but can't be read: rendered as usual (no prebuilt answer), never a 304.
// A page of 8 MiB served with 2 MiB of memory left in the request: streamed whole, with the tag of its bytes.
$large = str_repeat("<p>prebuilt page text</p>\n", intdiv(8 * 1024 * 1024, 26));
$aboutPath = \SpacePress\Render\Prebuilt::dir() . '/about.html';
$aboutBefore = (string) file_get_contents($aboutPath);
file_put_contents($aboutPath, $large);
$big = fetch("$url/about/", ['X-Swap: large']);
file_put_contents($aboutPath, $aboutBefore);
$out['prebuilt larger than memory_limit'] = [$big['status'], $big['prebuilt'], strlen($big['body']) === strlen($large), $big['etag'] === \SpacePress\Validator::bytes($large), strlen($large) > 2 * 1024 * 1024];
// A stream that ends before the size it reported, and one that reads nothing without ever ending:
// both render as usual, with no prebuilt header, and never a 304, whatever the client sends.
foreach (['short', 'empty-read'] as $mode) {
    $out["prebuilt $mode"] = array_map(static function (?string $match) use ($url, $mode): array {
        $r = fetch("$url/about/", ["X-Swap: $mode", ...($match === null ? [] : ["If-None-Match: $match"])]);
        return [$r['status'], $r['prebuilt'], $r['etag']];
    }, [null, '*']);
}
$out['prebuilt unreadable'] = array_map(static function (string $match) use ($url): array {
    $r = fetch("$url/about/", ['X-Swap: unreadable', "If-None-Match: $match"]);
    return [$r['status'], $r['prebuilt']];
}, ['*', '""']);
// The validator is the bytes served: another content of the same length, with the same modification
// time, is a 200 with the new body for a client holding the old tag (review 1, B5).
$aboutFile = \SpacePress\Render\Prebuilt::dir() . '/about.html';
clearstatcache();
$mtime = filemtime($aboutFile);
$changed = substr_replace($about['body'], 'ABOUT', (int) strpos($about['body'], 'About'), 5);
file_put_contents($aboutFile, $changed);
touch($aboutFile, $mtime);
clearstatcache();
$replaced = fetch("$url/about/", ['If-None-Match: ' . $about['etag']]);
$out['prebuilt same size and mtime'] = [strlen($changed) === strlen($about['body']), filemtime($aboutFile) === $mtime, $replaced['status'], $replaced['body'] === $changed, $replaced['etag'] !== $about['etag']];

// ---- the OpenAPI document --------------------------------------------------------------------------
$doc = fetch("$url/wp-json/spacepress/v1/openapi.json");
$decoded = json_decode($doc['body'], true);
$out['openapi'] = [$doc['status'], $doc['type'], $doc['cache'], $decoded['servers'][0]['url'] ?? null, isset($decoded['paths']), $decoded['openapi'] ?? null];
$out['openapi validators'] = $validated('/wp-json/spacepress/v1/openapi.json', $doc);
// The document's server is this site: another site name gives another body and another ETag.
update_option('blogname', 'Renamed');
$renamed = fetch("$url/wp-json/spacepress/v1/openapi.json");
$out['openapi follows the site'] = [$renamed['etag'] !== $doc['etag'], json_decode($renamed['body'], true)['servers'][0]['description'] ?? null];
// The bytes as before: the built file, its `servers` replaced, re-encoded (empty schemas stay objects).
$file = json_decode((string) file_get_contents($site->plugin()->dir . '/sp/app/openapi.json'), false);
$file->servers = [['url' => \SpacePress\Wp\Facade::url(), 'description' => 'Renamed']];
$out['openapi bytes'] = $renamed['body'] === json_encode($file, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
// The same document bytes with another modification time keep their tag; other bytes of the same
// length and time get another (review 1, B5).
$built = $site->plugin()->dir . '/sp/app/openapi.json';
touch($built, filemtime($built) + 3600);
clearstatcache();
$touched = fetch("$url/wp-json/spacepress/v1/openapi.json");
$bytes = (string) file_get_contents($built);
clearstatcache();
$builtTime = filemtime($built);
file_put_contents($built, str_replace('"openapi": "3.1.0"', '"openapi": "3.1.1"', $bytes));
touch($built, $builtTime);
clearstatcache();
$edited = fetch("$url/wp-json/spacepress/v1/openapi.json", ['If-None-Match: ' . $touched['etag']]);
file_put_contents($built, $bytes);
// An OpenAPI file that can't be read is no document: never a 304, whatever the client holds.
chmod($built, 0000);
clearstatcache();
$out['openapi unreadable'] = array_map(static fn (string $match): int => fetch("$url/wp-json/spacepress/v1/openapi.json", ["If-None-Match: $match"])['status'], ['*', '""']);
// The matcher itself, on headers a test request can't carry or shouldn't have to: a line break after
// a tag is not part of a list of tags, and a long list is read in one pass (a regex over it ran out
// of stack at 20,000 tags and lost the match).
$named = static function (string $header): bool {
    $_SERVER['HTTP_IF_NONE_MATCH'] = addslashes($header);
    try {
        return \SpacePress\Validator::matches('"hit"');
    } finally {
        unset($_SERVER['HTTP_IF_NONE_MATCH']);
    }
};
$out['matcher'] = [
    'line break' => array_map($named, ["\"hit\"\n", "\"hit\",\n", "\"miss\", \"hit\"\r\n"]),
    'control bytes in a tag' => array_map($named, ["\"hit\", \"a\x00b\"", "\"hit\", \"a\x7Fb\"", '"hit", "a b"']),
    'long list' => array_map($named, [str_repeat('"miss",', 49_999) . '"hit"', '"hit",' . str_repeat('"miss",', 49_999), str_repeat('"miss",', 50_000)]),
];
chmod($built, 0644);
$out['openapi tag follows the bytes'] = [$touched['etag'] === $renamed['etag'], $edited['status'], json_decode($edited['body'], true)['openapi'] ?? null, $edited['etag'] !== $touched['etag']];

// ---- the facade's reads stay private -----------------------------------------------------------------
$list = fetch("$url/wp-json/spacepress/v1/notes");
$out['facade'] = [$list['status'], $list['cache'], $list['etag'], fetch("$url/wp-json/spacepress/v1/notes", ['If-None-Match: *'])['status']];

$site->stopServer();
echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
