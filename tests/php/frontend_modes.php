<?php

declare(strict_types=1);

/*
 * Front-end modes on WordPress over HTTP (tests/app_router.rs `frontend_modes_on_wordpress`): one
 * build of tests/fixtures/frontend-modes (a variant: theme default, first/app/, `frontend: false`
 * or an external URL), installed with every plugin active and the theme front end on.
 * Prints one JSON object: label => observed.
 *
 *   FIRST_WP_THEMES=1 php tests/php/frontend_modes.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

// A must-use plugin stands in for the host's purge listener.
$site = wpSite('modes', ['wpContent' => $argv[1], 'muPlugins' => ['host' => <<<'PHP'
    <?php
    add_action('first_purge_urls', static function (array $paths): void {
        update_option('test_purges', [...get_option('test_purges', []), ...$paths], false);
    });
    PHP]]);
wp_set_current_user(1);
// WordPress's own sample post, so "a post the theme renders" exists in every mode.
$hello = get_post(1);
$note = \First\db()->insert('notes', ['title' => 'Hello note', 'slug' => 'hello-note', 'body' => '<!-- wp:paragraph --><p>Body text.</p><!-- /wp:paragraph -->', 'status' => 'published'])[0] ?? null;
$draft = \First\db()->insert('notes', ['title' => 'Draft note', 'slug' => 'draft-note', 'status' => 'draft']);
$entry = \First\db()->insert('journal', ['title' => 'Day one', 'slug' => 'day-one', 'status' => 'published', 'publishedAt' => '2026-03-04T10:00:00.000Z']);
$noteId = (int) (\First\db()->findFirst('notes', ['where' => ['slug' => 'hello-note']])['id']);
// For the sitemap: rows a visitor may not read, in every way a rule can say so.
\First\db()->insert('drafts', ['title' => 'Desk only', 'slug' => 'desk-only', 'status' => 'published']);
\First\db()->insert('briefs', ['title' => 'Open brief', 'slug' => 'open-brief', 'status' => 'published']);
\First\db()->insert('briefs', ['title' => 'Embargoed brief', 'slug' => 'embargoed-brief', 'embargoed' => true, 'status' => 'published']);
\First\db()->insert('briefs', ['title' => 'Draft brief', 'slug' => 'draft-brief', 'status' => 'draft']);
\First\db()->insert('memos', ['title' => 'A memo', 'status' => 'published']);
\First\db()->insert('cases', ['title' => 'Confidential case', 'slug' => 'confidential-case', 'status' => 'published']);
\First\db()->insert('vault', ['title' => 'Vault item', 'slug' => 'vault-item', 'status' => 'published']);
\First\db()->insert('notes', ['title' => 'Locked note', 'slug' => 'locked-note', 'status' => 'published']);
wp_update_post(['ID' => (int) \First\db()->findFirst('notes', ['where' => ['slug' => 'locked-note']])['id'], 'post_password' => 'secret']);
wp_insert_post(['post_type' => 'post', 'post_status' => 'draft', 'post_title' => 'Core draft', 'post_name' => 'core-draft']);
wp_insert_post(['post_type' => 'post', 'post_status' => 'private', 'post_title' => 'Core private', 'post_name' => 'core-private']);
wp_insert_post(['post_type' => 'post', 'post_status' => 'publish', 'post_title' => 'Core locked', 'post_name' => 'core-locked', 'post_password' => 'secret']);
// Two authors with a published post each; only the editor's user row is a visitor's to read.
wp_insert_post(['post_type' => 'post', 'post_status' => 'publish', 'post_title' => 'By the editor', 'post_name' => 'by-the-editor', 'post_author' => $site->userId('editor')]);
\First\db()->update('members', ['listed' => true], ['id' => $site->userId('editor')]);
// Those core writes ran outside a transaction, so their purge waits for the end of the request;
// this process is many requests long, so end that one here.
\First\Wp\Purges::flush();
$site->actAs(null);
$site->startServer();
$url = $site->url();

function fetch(string $url, string $method = 'GET'): array
{
    $ch = curl_init($url);
    $out = [];
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$out): int {
            if (str_contains($line, ':')) {
                [$name, $value] = explode(':', $line, 2);
                $out[strtolower(trim($name))][] = trim($value);
            }
            return strlen($line);
        },
    ]);
    $body = (string) curl_exec($ch);
    return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'location' => $out['location'][0] ?? null, 'body' => $body];
}

$strip = static fn (?string $u): ?string => $u === null ? null : str_replace($url, '', $u);
$got = static fn (string $path) => fetch($url . $path);
$note1 = $got('/notes/hello-note/');
// Who rendered a page: the block theme's template (First's default theme, `first-default`), or the
// app router (its router region and module).
$rendered = static function (array $r): array {
    return [
        'status' => $r['status'],
        'theme' => str_contains($r['body'], 'wp-theme-first-default') && str_contains($r['body'], 'wp-block-template-part'),
        'router' => str_contains($r['body'], 'data-wp-router-region') || str_contains($r['body'], 'first/Render/client/router.js'),
    ];
};
$hello = $got('/hello-world/');
$out = [
    'home rendered' => $rendered($got('/')),
    'note rendered' => $rendered($note1),
    'post rendered' => $rendered($hello),
    'post body' => str_contains($hello['body'], 'Welcome to WordPress'),
    'missing rendered' => $rendered($got('/no-such-page/')),
    'missing by wordpress' => str_contains($got('/no-such-page/')['body'], 'class="error404'),
    'note status' => $note1['status'],
    'note by theme' => str_contains($note1['body'], 'wp-block-post-title') || str_contains($note1['body'], 'Hello note'),
    'note by app' => str_contains($note1['body'], 'class="app-note"'),
    'note body' => str_contains($note1['body'], 'Body text.</p>'),
    'draft' => $got('/notes/draft-note/')['status'],
    'missing note' => $got('/notes/nope/')['status'],
    'journal' => $got('/journal/2026/day-one/')['status'],
    'journal wrong year' => [$got('/journal/2025/day-one/')['status'], $strip($got('/journal/2025/day-one/')['location'])],
    'permalink' => $strip(get_permalink($noteId)),
    'about' => [$got('/about/')['status'], str_contains($got('/about/')['body'], 'class="app-about"')],
    'post' => [$got('/?p=1')['status'], $strip($got('/?p=1')['location'])],
    'home' => $got('/')['status'],
    'rest' => $got('/wp-json/')['status'],
    'rest note' => $got('/wp-json/wp/v2/first_notes/' . $noteId)['status'],
    'feed' => $got('/feed/')['status'],
];
// Authors: the users kind's read rule shows a visitor the editor's row only, so the editor is a public
// author (archive, `?author=<id>`, oEmbed) and the admin, who also has a published post, is not.
$editorId = $site->userId('editor');
$embed = static function (string $path) use ($got, $url, $strip): array {
    $data = (array) json_decode($got('/wp-json/oembed/1.0/embed?url=' . rawurlencode($url . $path))['body'], true);
    return [($data['author_name'] ?? null) === get_bloginfo('name'), $strip($data['author_url'] ?? null)];
};
$byId = $got('/?author=' . $editorId);
$out['authors'] = [
    'listed' => $got('/author/editor/')['status'],
    'unlisted' => $got('/author/admin/')['status'],
    'unknown' => $got('/author/nobody/')['status'],
    'listed by id' => [$byId['status'], $strip($byId['location'])],
    'unlisted by id' => $got('/?author=1')['status'],
    'both ids' => $got('/?author=1,' . $editorId)['status'],
    'listed embed' => $embed('/by-the-editor/'),
    'unlisted embed' => $embed('/hello-world/'),
    'core route' => [$got('/wp-json/wp/v2/users/' . $editorId)['status'], $got('/wp-json/wp/v2/users')['status']],
    // First's API serves the kind by its rule: a visitor lists and reads the listed user only.
    'api list' => array_column((array) (json_decode($got('/__first/api/v1/members')['body'], true)['data'] ?? []), 'id') === [$editorId],
    'api listed' => $got('/__first/api/v1/members/' . $editorId)['status'],
    'api unlisted' => $got('/__first/api/v1/members/1')['status'],
    'api missing' => $got('/__first/api/v1/members/99999999')['status'],
];
// A write to a user's row purges their archive: whether it answers depends on that row.
delete_option('test_purges');
wp_set_current_user(1);
\First\db()->update('members', ['listed' => false], ['id' => $editorId]);
$site->actAs(null);
wp_cache_delete('test_purges', 'options');
$out['authors']['purged'] = in_array('/author/editor/', get_option('test_purges', []), true);
$out['authors']['unlisted after'] = $got('/author/editor/')['status'];
wp_set_current_user(1);
\First\db()->update('members', ['listed' => true], ['id' => $editorId]);
$site->actAs(null);
// A slug change: the old URL 301s to the new one, and both URLs (with twins) are purged.
delete_option('test_purges');
wp_set_current_user(1);
\First\db()->update('notes', ['slug' => 'renamed-note'], ['id' => $noteId]);
$site->actAs(null);
$old = $got('/notes/hello-note/');
$out['renamed'] = [$old['status'], $strip($old['location'])];
wp_cache_delete('test_purges', 'options');
$purged = get_option('test_purges', []);
$out['renamed purges'] = array_values(array_intersect(['/notes/hello-note/', '/notes/hello-note.md', '/notes/renamed-note/', '/notes/renamed-note.md'], $purged));
$out['new url'] = $got('/notes/renamed-note/')['status'];
// The sitemap, as a crawler reads it: the index, then every file it names. Core renders the XML.
$locs = static function (string $xml): array {
    $doc = @simplexml_load_string($xml);
    $out = [];
    foreach ($doc === false ? [] : $doc->children() as $entry) {
        $out[] = (string) $entry->loc;
    }
    return $out;
};
$index = $got('/wp-sitemap.xml');
$files = $locs($index['body']);
$listed = [];
foreach ($files as $file) {
    $listed[$strip($file)] = array_map($strip, $locs(fetch($file)['body']));
}
$out['sitemap'] = [
    'status' => $index['status'],
    'files' => array_map($strip, $files),
    'urls' => $listed,
    'robots' => (bool) preg_match('#^Sitemap: .*/wp-sitemap\.xml$#m', $got('/robots.txt')['body']),
    'unknown kind' => $got('/wp-sitemap-first-memos-1.xml')['status'],
    'past the end' => $got('/wp-sitemap-first-notes-2.xml')['status'],
    // An editor's own request lists what a visitor sees: the sitemap is one document for everyone.
    'as editor' => (static function () use ($site, $url, $locs, $strip): array {
        $id = $site->userId('editor');
        $expires = time() + 3600;
        $cookie = wp_generate_auth_cookie($id, $expires, 'logged_in', WP_Session_Tokens::get_instance($id)->create($expires));
        $ch = curl_init("$url/wp-sitemap-first-briefs-1.xml");
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_HTTPHEADER => ['Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode($cookie)]]);
        return array_map($strip, $locs((string) curl_exec($ch)));
    })(),
    // A visitor who has entered a post's password still gets the document everyone gets.
    'with a post password' => (static function () use ($url, $locs, $strip): array {
        require_once ABSPATH . WPINC . '/class-phpass.php';
        $cookie = 'Cookie: wp-postpass_' . COOKIEHASH . '=' . rawurlencode((new PasswordHash(8, true))->HashPassword('secret'));
        $out = [];
        foreach (['/wp-sitemap-first-notes-1.xml', '/wp-sitemap-posts-post-1.xml'] as $file) {
            $ch = curl_init($url . $file);
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_HTTPHEADER => [$cookie]]);
            $out[$file] = array_map($strip, $locs((string) curl_exec($ch)));
        }
        return $out;
    })(),
];
// Core's home entry is dated from the newest post the sitemap lists, not from a protected one: make
// the protected post the newest change on the site.
global $wpdb;
$wpdb->update($wpdb->posts, ['post_modified_gmt' => gmdate('Y-m-d H:i:s', time() + 86400), 'post_modified' => gmdate('Y-m-d H:i:s', time() + 86400)], ['post_name' => 'core-locked']);
clean_post_cache((int) $wpdb->get_var("SELECT ID FROM {$wpdb->posts} WHERE post_name = 'core-locked'"));
$out['sitemap']['home lastmod'] = (static function () use ($got): ?string {
    $doc = @simplexml_load_string($got('/wp-sitemap-posts-page-1.xml')['body']);
    foreach ($doc === false ? [] : $doc->children() as $entry) {
        if (str_ends_with((string) $entry->loc, '/') && substr_count(parse_url((string) $entry->loc, PHP_URL_PATH) ?? '/', '/') === 1) {
            return (string) $entry->lastmod;
        }
    }
    return null;
})();
$out['sitemap']['newest public post'] = (string) wp_date(DATE_W3C, (int) strtotime(get_posts(['post_status' => 'publish', 'has_password' => false, 'numberposts' => 1, 'orderby' => 'modified'])[0]->post_modified_gmt . ' UTC'));
// A write purges the sitemap files that list the item, with its other URLs.
delete_option('test_purges');
wp_set_current_user(1);
\First\db()->update('briefs', ['title' => 'Open brief, revised'], ['slug' => 'open-brief']);
$site->actAs(null);
wp_cache_delete('test_purges', 'options');
$out['sitemap']['purged'] = array_values(array_filter(get_option('test_purges', []), static fn (string $p): bool => str_contains($p, 'wp-sitemap')));
// A write that only changes who may read a row (the field the rule filters on) purges the kind's
// files too, and the next sitemap no longer lists the row.
delete_option('test_purges');
wp_set_current_user(1);
\First\db()->update('briefs', ['embargoed' => true], ['slug' => 'open-brief']);
$site->actAs(null);
wp_cache_delete('test_purges', 'options');
$out['sitemap']['purged by a field'] = array_values(array_filter(get_option('test_purges', []), static fn (string $p): bool => str_contains($p, 'wp-sitemap')));
$out['sitemap']['briefs after'] = array_map($strip, $locs(fetch("$url/wp-sitemap-first-briefs-1.xml")['body']));
$out['sitemap']['briefs status after'] = fetch("$url/wp-sitemap-first-briefs-1.xml")['status'];
// `publicAuthors: true` with a users kind: every author is in the sitemap, as WordPress ships it.
$schemaFile = \First\Wp\Runtime::plugin()->dir . '/first/app/schema.php';
$schemaPhp = (string) file_get_contents($schemaFile);
file_put_contents($schemaFile, str_replace("    'admin' => false,\n", "    'admin' => false,\n    'publicAuthors' => true,\n", $schemaPhp));
$everyone = array_map($strip, $locs(fetch("$url/wp-sitemap-users-1.xml")['body']));
sort($everyone);
$out['authors']['public sitemap'] = $everyone;
file_put_contents($schemaFile, $schemaPhp);
// wp-admin and sign-in in a browser, in this mode (FIRST_TEST_BROWSER=1; the Rust test sets it
// when the browser test's packages are installed).
if (getenv('FIRST_TEST_BROWSER') === '1') {
    $script = dirname(__DIR__) . '/differential/client/admin-login.mjs';
    $browser = shell_exec('node ' . escapeshellarg($script) . ' ' . escapeshellarg($url) . ' 2>&1');
    $out['admin'] = json_decode((string) $browser, true) ?? ['raw' => $browser];
}
echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
$site->destroy();
