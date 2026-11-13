<?php

declare(strict_types=1);

/*
 * `page.md` routes on WordPress over HTTP (tests/app_router.rs `page_md_is_a_wordpress_page`): the
 * app-router fixture as built, then two later builds of it (files changed, removed, added, and
 * taken away from visitors) installed over it in turn. Prints one JSON object: label => observed.
 *
 *   FIRST_WP_THEMES=1 php tests/php/app_content.php <wp-content dir> <second build's> <third build's>
 */

require __DIR__ . '/wp.php';

// A must-use plugin stands in for the host: it records each `first_purge_urls` announcement.
$site = wpSite('app-content', ['wpContent' => $argv[1], 'users' => ['reader' => 'subscriber', 'chief' => 'editor'],
    'muPlugins' => ['secret' => "<?php define('APPROUTER_HOOK_SECRET', 'hook-secret');", 'host' => <<<'PHP'
        <?php
        add_action('first_purge_urls', static function (array $paths): void {
            $seen = get_option('test_purges', []);
            $seen[] = $paths;
            update_option('test_purges', $seen, false);
        });
        PHP]]);
$site->actAs(null);
$site->startServer();
$url = $site->url();

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
    $text = (string) curl_exec($ch);
    return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'headers' => $out, 'body' => $text];
}

/** The router region's contents, the document title and the headers that matter. */
function page(array $r): array
{
    preg_match('#<title>(.*?)</title>#s', $r['body'], $t);
    preg_match('#data-wp-router-region="first/main">(.*)</div>\n#s', $r['body'], $m);
    preg_match('#<meta name="description" content="(.*?)">#', $r['body'], $d);
    preg_match('#<link rel="canonical" href="(.*?)">#', $r['body'], $c);
    return [
        'status' => $r['status'], 'title' => html_entity_decode($t[1] ?? '', ENT_QUOTES), 'body' => $m[1] ?? null,
        'description' => $d[1] ?? null, 'canonical' => $c[1] ?? null, 'cache' => $r['headers']['cache-control'][0] ?? null,
        'location' => $r['headers']['location'][0] ?? null,
    ];
}

// One session per user: the logged-in cookie, and nonces minted for the same session token.
$sessions = [];
$session = static function (string $user, ?string $action = null) use ($site, &$sessions): string {
    $id = $site->userId($user);
    $sessions[$user] ??= (static function () use ($id): array {
        $expires = time() + 3600;
        $token = WP_Session_Tokens::get_instance($id)->create($expires);
        return [$token, wp_generate_auth_cookie($id, $expires, 'logged_in', $token)];
    })();
    [, $value] = $sessions[$user];
    if ($action === null) {
        return 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode($value);
    }
    $_COOKIE[LOGGED_IN_COOKIE] = $value;
    wp_set_current_user($id);
    $nonce = wp_create_nonce($action);
    wp_set_current_user(0);
    unset($_COOKIE[LOGGED_IN_COOKIE]);
    return $nonce;
};
$cookie = static fn (string $user): string => $session($user);
/** The stored Page of a route, read fresh (the server process writes it). */
$stored = static function (string $route): ?array {
    wp_cache_flush();
    $found = get_posts(['post_type' => 'page', 'post_status' => ['publish', 'draft', 'private', 'trash'], 'meta_key' => '_first_route', 'meta_value' => $route, 'numberposts' => -1]);
    if (count($found) !== 1) {
        return ['count' => count($found)];
    }
    $p = $found[0];
    return ['id' => $p->ID, 'type' => $p->post_type, 'status' => $p->post_status, 'title' => $p->post_title, 'slug' => $p->post_name, 'excerpt' => $p->post_excerpt, 'content' => $p->post_content, 'link' => get_permalink($p)];
};
$edit = static function (string $as, array $post) use ($site): void {
    $site->actAs($as);
    $id = wp_update_post(wp_slash($post), true);
    $site->actAs(null);
    if ($id instanceof WP_Error) {
        throw new RuntimeException($id->get_error_message());
    }
};
/** Everything WordPress itself publishes about Pages to anonymous visitors. */
$public = static fn (): string => implode("\n", array_map(static fn (string $path): string => fetch($url . $path)['body'], [
    '/wp-json/wp/v2/pages?per_page=100', '/wp-json/wp/v2/search?search=launch', '/wp-json/wp/v2/search?search=house', '/wp-sitemap-posts-page-1.xml', '/feed/', '/llms.txt',
]));

$out = [];
// ---- the first build: each page.md is a Page, rendered inside the route's layouts.
$out['guide'] = page(fetch("$url/guide"));
$out['guide stored'] = $stored('(site)/guide');
$out['guide twin'] = [fetch("$url/guide.md")['status'], fetch("$url/guide.md")['body'], fetch("$url/guide.md")['headers']['content-type'][0] ?? null];
$out['guide twin link'] = $out['guide twin'] !== null ? (fetch("$url/guide")['headers']['link'] ?? []) : [];
$out['colophon'] = page(fetch("$url/colophon"));
$out['colophon stored'] = $stored('colophon');
// A draft: the Page exists for its editors, and no anonymous surface shows it.
$out['hidden'] = page(fetch("$url/hidden"));
$out['hidden stored'] = $stored('hidden');
$out['hidden as editor'] = page(fetch("$url/hidden", [$cookie('chief')]));
$out['hidden as subscriber'] = page(fetch("$url/hidden", [$cookie('reader')]))['status'];
$out['hidden twin'] = fetch("$url/hidden.md")['status'];
$out['hidden twin as editor'] = fetch("$url/hidden.md", [$cookie('chief')])['status'];
// A page under a layout guard: stored private, shown to whoever the guard admits.
$terms = fetch("$url/account/terms");
$out['terms anonymous'] = [$terms['status'], str_contains($terms['headers']['location'][0] ?? '', 'wp-login.php')];
$out['terms subscriber'] = page(fetch("$url/account/terms", [$cookie('reader')]));
$out['terms stored'] = $stored('account/terms');
$out['terms twin'] = fetch("$url/account/terms.md", [$cookie('reader')])['status'];
$leaks = $public();
$out['leaks'] = array_values(array_filter(['launch is on the ninth', 'Unannounced', 'Not for visitors yet', 'house rules', 'Member terms'], static fn (string $needle): bool => str_contains($leaks, $needle)));
$out['llms'] = fetch("$url/llms.txt")['body'];
// WordPress's own address for the Page goes to the route.
$byId = fetch("$url/?page_id=" . $out['guide stored']['id']);
$out['by id'] = [$byId['status'], $byId['headers']['location'][0] ?? null];

// ---- an editor changes the Page in wp-admin: the route shows it, and its cached copies are purged.
$guide = (int) $out['guide stored']['id'];
delete_option('test_purges');
$edit('chief', ['ID' => $guide, 'post_title' => 'Field guide, revised', 'post_excerpt' => 'Edited on the site.',
    'post_content' => "<!-- wp:paragraph -->\n<p>Edited in the block editor.</p>\n<!-- /wp:paragraph -->"]);
\First\Wp\Purges::flush(); // a wp-admin save announces when its request ends
wp_cache_delete('test_purges', 'options');
$out['purged'] = array_merge(...get_option('test_purges', []));
$out['guide edited'] = page(fetch("$url/guide"));
$out['guide edited twin'] = fetch("$url/guide.md")['body'];
// Their unsaved changes show to them from the editor's Preview link, and to nobody else.
require_once ABSPATH . 'wp-admin/includes/post.php'; // wp_create_post_autosave, as the editor's autosave calls it
$site->actAs('chief');
wp_create_post_autosave(['post_ID' => $guide, 'post_type' => 'page', 'post_title' => 'Field guide, revised', 'post_excerpt' => 'Edited on the site.',
    'post_content' => "<!-- wp:paragraph -->\n<p>Not saved yet.</p>\n<!-- /wp:paragraph -->"]);
$site->actAs(null);
$preview = "$url/guide?preview=true&preview_id=$guide&preview_nonce=";
$out['preview as editor'] = page(fetch($preview . $session('chief', 'post_preview_' . $guide), [$cookie('chief')]));
$out['preview without nonce'] = fetch($preview . 'nope', [$cookie('chief')]);
$out['preview anonymous'] = fetch($preview . $session('chief', 'post_preview_' . $guide));
foreach (['preview without nonce', 'preview anonymous'] as $key) {
    $out[$key] = [$out[$key]['status'], str_contains($out[$key]['body'], 'Not saved yet.')];
}
// A password locks the body for every visitor; unpublishing takes the page away.
$edit('chief', ['ID' => $guide, 'post_password' => 'open sesame']);
$out['locked'] = page(fetch("$url/guide"));
$out['locked twin'] = fetch("$url/guide.md")['body'];
require_once ABSPATH . WPINC . '/class-phpass.php';
$out['locked with cookie'] = page(fetch("$url/guide", ['Cookie: wp-postpass_' . COOKIEHASH . '=' . rawurlencode((new PasswordHash(8, true))->HashPassword('open sesame'))]))['body'];
$edit('chief', ['ID' => $guide, 'post_password' => '', 'post_status' => 'draft']);
$out['unpublished'] = [page(fetch("$url/guide"))['status'], fetch("$url/guide.md")['status']];
$edit('chief', ['ID' => $guide, 'post_status' => 'publish']);
$out['republished'] = page(fetch("$url/guide"))['status'];

// ---- the second build, installed over the first: files changed, one removed, one added.
$app = glob($site->dir . '/content/plugins/first-app-*')[0];
$install = static function (string $wpContent) use ($site, $app): void {
    $site->stopServer();
    exec('rm -rf ' . escapeshellarg($app));
    wpCopy($wpContent . '/plugins/' . basename($app), $app);
};
$install($argv[2]);
// Six server workers, so the first requests for the new build really run at the same time.
putenv('PHP_CLI_SERVER_WORKERS=6');
$site->startServer();
putenv('PHP_CLI_SERVER_WORKERS');
$url = $site->url();
// Each new file version must be stored once, whichever of them gets there first.
$multi = curl_multi_init();
$handles = [];
foreach (['/colophon', '/news', '/guide', '/colophon', '/news', '/', '/about', '/news'] as $path) {
    $handles[] = $h = curl_init($url . $path);
    curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60]);
    curl_multi_add_handle($multi, $h);
}
do {
    curl_multi_exec($multi, $running);
    curl_multi_select($multi, 1.0);
} while ($running > 0);
$out['concurrent'] = array_map(static fn ($h): int => (int) curl_getinfo($h, CURLINFO_RESPONSE_CODE), $handles);
$out['second colophon'] = page(fetch("$url/colophon"));
$out['second colophon stored'] = $stored('colophon');
$out['second news'] = page(fetch("$url/news"));
$out['second news stored'] = $stored('news');
// The editor's version wins over a changed file.
$out['second guide'] = page(fetch("$url/guide"));
// A removed page.md leaves its Page on the site, and its URL is no longer the app's.
$out['second hidden'] = page(fetch("$url/hidden"))['status'];
$out['second hidden stored'] = $stored('hidden');
// ---- the third build takes two pages away from visitors: the guide becomes a draft, and the
// colophon moves under the account layout's guard. The site has lost its record of the Pages.
$edit('chief', ['ID' => (int) $out['second colophon stored']['id'], 'post_content' => "<!-- wp:paragraph -->\n<p>Kept by the site.</p>\n<!-- /wp:paragraph -->"]);
delete_option('first_approuter_content');
$install($argv[3]);
$site->startServer();
$url = $site->url();
$out['third guide'] = [page(fetch("$url/guide"))['status'], fetch("$url/guide.md")['status']];
// The editor's text is still the Page's; only its status followed the file.
$out['third guide stored'] = $stored('(site)/guide');
$out['third colophon anonymous'] = fetch("$url/account/colophon")['status'];
$out['third colophon subscriber'] = page(fetch("$url/account/colophon", [$cookie('reader')]));
$out['third colophon stored'] = $stored('account/colophon');
// The route moved, so its Page is a new one; the old one stays where WordPress has it.
$out['third old colophon'] = $stored('colophon');
$leaks = $public();
$out['third leaks'] = array_values(array_filter(['Edited in the block editor', 'Field guide, revised', 'Members only colophon'], static fn (string $needle): bool => str_contains($leaks, $needle)));
wp_cache_flush();
$out['pages'] = array_map('intval', $GLOBALS['wpdb']->get_col("SELECT COUNT(*) FROM {$GLOBALS['wpdb']->postmeta} WHERE meta_key = '_first_route' GROUP BY meta_value"));

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), "\n";
$site->destroy();
