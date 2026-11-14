<?php

declare(strict_types=1);

/*
 * What one committed write announces (tests/app_router.rs `one_write_announces_its_purges_once`):
 * tests/fixtures/app-purges on WordPress with php -S, a must-use plugin standing in for the host and
 * recording each `first_purge_urls` call. A kind with a `url` gets purges from two sources, the post
 * hooks (Wp\Purges) and the page cache's read index (Render\Cache); a write gives one call with both.
 * Prints JSON.
 *
 *   FIRST_WP_THEMES=1 php tests/php/app_purges.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('app-purges', ['wpContent' => $argv[1], 'muPlugins' => ['host' => <<<'PHP'
    <?php
    add_action('first_purge_urls', static function (array $paths): void {
        $GLOBALS['test_purges'][] = $paths;
    });
    PHP]]);
wp_set_current_user(1);
$hello = (int) \First\db()->insert('notes', ['title' => 'Hello', 'slug' => 'hello', 'status' => 'published'], true)[0]['id'];
$site->actAs(null);
$site->startServer();
$url = $site->url();

function fetch(string $url): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30]);
    $body = (string) curl_exec($ch);
    return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'location' => curl_getinfo($ch, CURLINFO_REDIRECT_URL) ?: null, 'body' => $body];
}

global $wpdb;
$reads = "{$wpdb->prefix}first__app_reads";
$stale = \First\Render\Prebuilt::ACTION;
/** What a write announced: every `first_purge_urls` call, and how many rebuilds Prebuilt::stale queued. */
$announced = static function (callable $write) use ($stale): array {
    \First\Wp\Purges::flush(); // what setting up queued goes out first
    $GLOBALS['test_purges'] = [];
    as_unschedule_all_actions($stale);
    wp_set_current_user(1);
    try {
        $write();
    } catch (\RuntimeException) {
    }
    \First\Wp\Purges::flush(); // the end of the request, for a write outside a transaction
    wp_set_current_user(0);
    return ['calls' => $GLOBALS['test_purges'], 'rebuilds' => count(as_get_scheduled_actions(['hook' => $stale, 'status' => 'pending', 'per_page' => -1], 'ids'))];
};
$edit = static fn (string $title) => static fn () => \First\db()->update('notes', ['title' => $title], ['id' => $hello]);

$out = [];
// Both spellings of the item's address, as a visitor may type either.
$slash = fetch("$url/notes/hello/");
$bare = fetch("$url/notes/hello");
$out['spellings'] = ['slash' => [$slash['status'], $slash['location']], 'bare' => [$bare['status'], $bare['location']], 'same html' => $slash['body'] === $bare['body']];
fetch("$url/");
fetch("$url/notes/hello.md");
$out['index'] = $wpdb->get_col("SELECT url FROM $reads ORDER BY url");

// One edit of a note an anonymous visitor's pages read: one call, each path once.
$out['edit'] = $announced($edit('Hello again'));

// The same edit saved through WordPress (wp-admin, core REST): still one call.
$out['editor edit'] = $announced(static fn () => wp_update_post(['ID' => $hello, 'post_title' => 'Hello from the editor']));

// A row recorded before addresses were stored canonically (the bare spelling): still purged.
$wpdb->query("DELETE FROM $reads WHERE url = '/notes/hello/'");
$wpdb->insert($reads, ['kind' => 'notes', 'item' => (string) $hello, 'url' => '/notes/hello', 'seenAt' => gmdate('Y-m-d\TH:i:s.000\Z')]);
$out['old row'] = $announced($edit('Hello once more'));

// A rolled-back write announces nothing.
$out['rolled back'] = $announced(static fn () => \First\db()->transaction(static function () use ($hello): void {
    \First\db()->update('notes', ['title' => 'Never'], ['id' => $hello]);
    throw new \RuntimeException('rollback');
}));

// Over the limit across both sources (neither alone over it): one whole-host purge.
$own = count($out['edit']['calls'][0] ?? []);
$listed = intdiv(\First\Wp\Purges::PURGE_LIMIT - $own, 3) + 1; // each listed page: both spellings and its twin
for ($i = 0; $i < $listed; $i++) {
    $wpdb->insert($reads, ['kind' => 'notes', 'item' => '*', 'url' => "/many/$i/", 'seenAt' => gmdate('Y-m-d\TH:i:s.000\Z')]);
}
$out['limit'] = ['index alone' => 3 * $listed <= \First\Wp\Purges::PURGE_LIMIT, 'union over' => $own + 3 * $listed > \First\Wp\Purges::PURGE_LIMIT] + $announced($edit('Hello at last'));

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
$site->destroy();
