<?php

declare(strict_types=1);

/*
 * Prebuilt pages next to server-rendered ones (tests/app_router.rs `prebuilt_pages_serve_before_wordpress_and_rebuild_after_writes`):
 * tests/fixtures/app-prebuilt, built by `first build`, on WordPress-on-SQLite served by php -S with
 * the theme front end on. Action Scheduler runs in this process, as WP-Cron would run it. Prints JSON.
 *
 *   FIRST_WP_THEMES=1 php tests/php/app_prebuilt.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('app-prebuilt', ['wpContent' => $argv[1], 'users' => ['chief' => 'editor']]);
wp_set_current_user(1);
$hello = \First\db()->insert('notes', ['title' => 'Hello', 'slug' => 'hello', 'status' => 'published'], true)[0];
\First\db()->insert('notes', ['title' => 'Secret', 'slug' => 'secret', 'status' => 'draft']);
$site->actAs(null);
$site->startServer();
$url = $site->url();

// The end of the request that wrote: WordPress post writes outside a transaction announce what they
// changed at shutdown (First\Wp\Purges), which this long-running test process never reaches.
$written = static fn () => \First\Wp\Purges::flush();

function fetch(string $url, array $headers = []): array
{
    $ch = curl_init($url);
    $out = [];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_HTTPHEADER => $headers,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$out): int {
            if (str_contains($line, ':')) {
                [$name, $value] = explode(':', $line, 2);
                $out[strtolower(trim($name))][] = trim($value);
            }
            return strlen($line);
        },
    ]);
    $body = (string) curl_exec($ch);
    return [
        'status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE),
        'prebuilt' => isset($out['x-first-prebuilt']),
        'cache' => $out['cache-control'][0] ?? null,
        'type' => $out['content-type'][0] ?? null,
        'body' => $body,
    ];
}

$drain = static function (): int {
    $ran = 0;
    for ($i = 0; $i < 10 && as_has_scheduled_action(\First\Render\Prebuilt::ACTION, null, 'first'); $i++) {
        $ran += ActionScheduler_QueueRunner::instance()->run('First tests');
    }
    return $ran;
};
$cookie = static function (string $user) use ($site): string {
    $id = $site->userId($user);
    return 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode(wp_generate_auth_cookie($id, time() + 3600, 'logged_in'));
};
$text = static fn (array $r, string $class): ?string => preg_match('#class="' . $class . '"[^>]*>(.*?)</#s', $r['body'], $m) === 1 ? $m[1] : null;

// What setting the site up changed (the hidden Pages of static routes) is announced before measuring.
$written();
$out = [];
// What to build, as an editor lists it (first export uses the same answer).
[$status, $list] = $site->call('GET', '/prerender', as: 'chief');
$out['list'] = [$status, array_column($list['urls'] ?? [], 'path')];
$out['list anonymous'] = $site->call('GET', '/prerender')[0];
$out['list subscriber'] = $site->call('GET', '/prerender', as: 'subscriber')[0];

// Before the prebuild has run, every page renders per request.
$out['before'] = fetch("$url/about")['prebuilt'];
// Init schedules the build once; Action Scheduler runs it.
$out['scheduled'] = as_has_scheduled_action(\First\Render\Prebuilt::ACTION, null, 'first');
$out['ran'] = $drain() > 0;
$dir = \First\Render\Prebuilt::dir();
$out['files'] = array_values(array_map(static fn (string $f): string => substr($f, strlen($dir) + 1), array_filter(
    iterator_to_array(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)), false),
    static fn ($f) => $f->isFile(),
)));
sort($out['files']);

$about = fetch("$url/about");
$out['about'] = [$about['status'], $about['prebuilt'], $about['cache'], $text($about, 'about') !== null, str_contains($about['body'], '<title>About · Prebuilt</title>')];
$twin = fetch("$url/about.md");
$out['about.md'] = [$twin['status'], $twin['prebuilt'], $twin['type'], $twin['body']];
$out['note'] = [fetch("$url/notes/hello")['prebuilt'], $text(fetch("$url/notes/hello"), 'note')];
$out['tag'] = [fetch("$url/tags/lab%20notes")['prebuilt'], $text(fetch("$url/tags/lab%20notes"), 'tag')];
// Not prebuilt: per request, as before.
$out['home'] = fetch("$url/")['prebuilt'];
$out['live'] = fetch("$url/live")['prebuilt'];
// A draft is never listed, so never written; it stays a 404 for visitors.
$out['draft'] = [fetch("$url/notes/secret")['status'], fetch("$url/notes/secret")['prebuilt']];
// A signed-in visitor, a query string, and a POST all fall through to WordPress.
$out['signed in'] = fetch("$url/about", [$cookie('chief')])['prebuilt'];
$out['query'] = fetch("$url/about?utm=x")['prebuilt'];
// A prerender header that isn't this site's is an ordinary request.
$out['forged'] = fetch("$url/notes/hello", ['X-First-Prerender: ' . str_repeat('0', 64), $cookie('chief')])['prebuilt'];

// On-demand regeneration: an edit deletes the note's files at once, so the next visitor gets the
// new title from WordPress; the action then writes the new files.
wp_set_current_user(1);
\First\db()->update('notes', ['title' => 'Hello again'], ['id' => (int) $hello['id']]);
$written();
$site->actAs(null);
$after = fetch("$url/notes/hello");
$out['after write'] = [$after['prebuilt'], $text($after, 'note')];
$out['about kept'] = fetch("$url/about")['prebuilt'];
$drain();
$rebuilt = fetch("$url/notes/hello");
$out['rebuilt'] = [$rebuilt['prebuilt'], $text($rebuilt, 'note')];
// A note published later gets its file from the same action, and unpublishing removes it.
wp_set_current_user(1);
$late = \First\db()->insert('notes', ['title' => 'Late', 'slug' => 'late', 'status' => 'published'], true)[0];
$written();
$site->actAs(null);
$drain();
$out['published later'] = fetch("$url/notes/late")['prebuilt'];
wp_set_current_user(1);
\First\db()->update('notes', ['status' => 'draft'], ['id' => (int) $late['id']]);
$written();
$site->actAs(null);
$out['unpublished'] = [fetch("$url/notes/late")['status'], fetch("$url/notes/late")['prebuilt']];
$drain();
$out['unpublished after rebuild'] = [fetch("$url/notes/late")['status'], fetch("$url/notes/late")['prebuilt']];


// A field stored outside the core post fields: the page read the item, so the write still names it.
wp_set_current_user(1);
\First\db()->update('notes', ['summary' => 'Fresh summary'], ['id' => (int) $hello['id']]);
$written();
$site->actAs(null);
$out['meta field'] = [fetch("$url/notes/hello")['prebuilt'], $text(fetch("$url/notes/hello"), 'summary')];
$drain();
$out['meta field rebuilt'] = [fetch("$url/notes/hello")['prebuilt'], $text(fetch("$url/notes/hello"), 'summary')];
// A site-wide setting no content write announces: every file goes, and the next build has it.
update_option('blogname', 'Renamed');
$out['renamed'] = [fetch("$url/about")['prebuilt'], fetch("$url/notes/hello")['prebuilt']];
do_action('init');
$drain();
$out['renamed rebuilt'] = fetch("$url/about")['prebuilt'];
// A file past MAX_AGE is not served; the next full build replaces it.
$file = \First\Render\Prebuilt::dir() . '/about.html';
touch($file, time() - \First\Render\Prebuilt::MAX_AGE - 10);
clearstatcache();
$out['too old'] = fetch("$url/about")['prebuilt'];
// `/index` is not the home page.
$out['index'] = fetch("$url/index")['prebuilt'];
// A gate (a private-site plugin) vetoes serving files; the request reaches WordPress.
file_put_contents($site->content . '/mu-plugins/gate.php', "<?php add_filter('first_prebuilt_serve', '__return_false');");
$out['gated'] = fetch("$url/notes/hello")['prebuilt'];
unlink($site->content . '/mu-plugins/gate.php');
// An expired or reused-past-expiry token is an ordinary request.
$expired = \First\Render\Prebuilt::token('/live', time() - 5);
$live = fetch("$url/live", ['X-First-Prerender: ' . $expired]);
$out['expired token'] = $live['cache'];
$fresh = fetch("$url/live", ['X-First-Prerender: ' . \First\Render\Prebuilt::token('/live')]);
$out['fresh token'] = $fresh['cache'];
// A value staticParams no longer lists loses its file at the next build.
update_option('prebuilt_drop', 'lab notes');
\First\Render\Prebuilt::stale(['/tags/lab%20notes']);
$drain();
$out['dropped value'] = [is_file(\First\Render\Prebuilt::dir() . '/tags/lab%20notes.html'), fetch("$url/tags/field")['prebuilt']];

// Another spelling of a prebuilt path is not its URL: `/%61bout` renders per request.
$out['encoded spelling'] = fetch("$url/%61bout")['prebuilt'];
// A coming-soon site serves no file, whatever plugin does the hiding.
update_option('wpcom_public_coming_soon', 1);
do_action('init');
$drain();
$out['coming soon'] = fetch("$url/notes/hello")['prebuilt'];
delete_option('wpcom_public_coming_soon');
// A whole-site purge before any file exists is not an error.
\First\Render\Prebuilt::forget();
\First\Render\Prebuilt::stale(['/*']);
$out['purge all, no files'] = true;
// A render older than a write that named its path is dropped, even inside one batch.
do_action('init');
$drain();
$before = fetch("$url/about")['prebuilt'];
\First\Render\Prebuilt::stale(['/about']);
$started = microtime(true) - 5; // as if the render began before the write
$m = new ReflectionMethod(\First\Render\Prebuilt::class, 'write');
$written = $m->invoke(null, \First\Render\Prebuilt::dir() . '/about.html', 'old', '/about', $started);
$out['race'] = [$before, $written, is_file(\First\Render\Prebuilt::dir() . '/about.html')];

// What a host that serves the files before PHP reads (docs/host-contract.md, "Prebuilt pages"):
// current.json names this build's directory and the headers to send, and goes with the files.
do_action('init');
$drain();
$pointer = json_decode((string) @file_get_contents(\First\Render\Prebuilt::pointer()), true);
$out['pointer'] = is_array($pointer) ? [
    $pointer['build'] === basename(\First\Render\Prebuilt::dir()),
    $pointer['maxAge'], $pointer['cacheControl'], $pointer['charset'], $pointer['home'],
    is_file(dirname(\First\Render\Prebuilt::pointer()) . '/' . $pointer['build'] . '/about.html'),
] : null;
\First\Render\Prebuilt::forget();
$out['pointer after forget'] = is_file(\First\Render\Prebuilt::pointer());
do_action('init');
$drain();
update_option('blog_public', -1);
$out['pointer while private'] = [is_file(\First\Render\Prebuilt::pointer())];
do_action('init');
$drain();
$out['pointer while private'][] = is_file(\First\Render\Prebuilt::pointer());
update_option('blog_public', 1);

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
$site->destroy();
