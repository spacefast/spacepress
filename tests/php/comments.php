<?php

declare(strict_types=1);

/*
 * `<Comments for={item} />` and the comment policy on every path (docs/decisions/2026-11-14-comments.md):
 * tests/fixtures/comments, built by `first build`, on WordPress with php -S. Comments arrive the
 * three ways they can: the component's form (form-encoded, as a browser with scripts off sends it),
 * the facade's `POST /__first/api/v1/comments`, and core's `wp-comments-post.php`. Prints one JSON
 * object of what each step saw.
 *
 *   FIRST_WP_THEMES=1 php tests/php/comments.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

// Core's flood check (one comment per author per 15 seconds) would refuse the test's quick
// succession; it is core's and stays on for real sites.
$site = wpSite('comments', ['wpContent' => $argv[1], 'users' => ['ann' => 'subscriber', 'bo' => 'subscriber'], 'muPlugins' => ['no-flood' => <<<'PHP'
    <?php
    add_filter('wp_is_comment_flood', '__return_false', PHP_INT_MAX);
    PHP, 'host' => <<<'PHP'
    <?php
    // A host that keeps cached pages, recording each purge it is asked for.
    add_action('first_purge_urls', static function (array $paths): void {
        update_option('test_purges', [...get_option('test_purges', []), ...$paths], false);
    });
    PHP]]);
wp_set_current_user(1);
\First\db()->insert('notes', ['title' => 'Open note', 'slug' => 'open-note', 'status' => 'published']);
\First\db()->insert('notes', ['title' => 'Draft note', 'slug' => 'draft-note', 'status' => 'draft']);
\First\db()->insert('memos', ['title' => 'A memo', 'status' => 'published']);
$note = (int) \First\db()->findFirst('notes', ['where' => ['slug' => 'open-note']])['id'];
$draft = (int) \First\db()->findFirst('notes', ['where' => ['slug' => 'draft-note']])['id'];
$memo = (int) \First\db()->findFirst('memos', [])['id'];
// What a site admin may set in Discussion settings must not change what the app declared.
update_option('comment_registration', 0);
update_option('comment_moderation', 1); // "hold every comment": the app's first-time policy wins
update_option('comment_previously_approved', 0);
update_option('thread_comments_depth', 10);
// An approved comment already on the note, by the site admin.
$seeded = wp_insert_comment(['comment_post_ID' => $note, 'comment_content' => 'First!', 'comment_author' => 'admin', 'user_id' => 1, 'comment_approved' => 1]);
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

function xpath(string $html): DOMXPath
{
    $doc = new DOMDocument();
    @$doc->loadHTML('<?xml encoding="utf-8"?>' . $html);
    return new DOMXPath($doc);
}

/** What the thread shows: each comment's text with its depth and whether it is marked held. */
function thread(string $html): array
{
    $x = xpath($html);
    $out = [];
    foreach ($x->query("//li[contains(@class,'first-comment')]") as $li) {
        $depth = $x->query("ancestor::ol", $li)->length;
        $body = trim($x->query(".//div[@class='first-comment-body']", $li)->item(0)?->textContent ?? '');
        $out[] = str_repeat('>', $depth - 1) . $body . (str_contains($li->getAttribute('class'), 'held') ? ' (held)' : '');
    }
    return $out;
}

/** The forms on the page: [parent, hidden fields]. */
function forms(string $html): array
{
    $x = xpath($html);
    $out = [];
    foreach ($x->query("//form[contains(@class,'first-comments')]") as $form) {
        $fields = [];
        foreach ($x->query(".//input[@type='hidden']", $form) as $input) {
            $fields[$input->getAttribute('name')] = $input->getAttribute('value');
        }
        $out[] = ['action' => parse_url($form->getAttribute('action'), PHP_URL_PATH), 'fields' => $fields];
    }
    return $out;
}

function text(string $html, string $class): ?string
{
    foreach (xpath($html)->query("//*[contains(@class,'$class')]") as $node) {
        return trim($node->textContent);
    }
    return null;
}

/** Posts a comment form as a browser does, and follows the 303 with both cookies. */
function post(array $form, string $content, array $session): array
{
    $body = http_build_query($form['fields'] + ['content' => $content]);
    $cookie = $session === [] ? '' : substr($session[0], strlen('Cookie: '));
    $post = fetch($GLOBALS['url'] . $form['action'], 'POST', [...$session, 'Content-Type: application/x-www-form-urlencoded'], $body);
    $flash = explode(';', $post['headers']['set-cookie'][0] ?? '')[0];
    $location = $post['headers']['location'][0] ?? null;
    $back = $location === null ? null : fetch($location, headers: ['Cookie: ' . implode('; ', array_filter([$cookie, $flash]))]);
    return ['status' => $post['status'], 'back' => $back];
}

$session = static function (string $who) use ($site): array {
    $id = $site->userId($who);
    $expires = time() + 3600;
    $token = WP_Session_Tokens::get_instance($id)->create($expires);
    return ['Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode(wp_generate_auth_cookie($id, $expires, 'logged_in', $token))];
};
$nonceFor = static function (string $who) use ($site): string {
    $id = $site->userId($who);
    $expires = time() + 3600;
    $token = WP_Session_Tokens::get_instance($id)->create($expires);
    $_COOKIE[LOGGED_IN_COOKIE] = wp_generate_auth_cookie($id, $expires, 'logged_in', $token);
    wp_set_current_user($id);
    $nonce = wp_create_nonce('wp_rest');
    $cookie = 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode($_COOKIE[LOGGED_IN_COOKIE]);
    wp_set_current_user(0);
    unset($_COOKIE[LOGGED_IN_COOKIE]);
    return $nonce . "\n" . $cookie;
};
$status = static fn (int $id): string => (string) wp_get_comment_status($id);
$count = static fn (): int => (int) get_comments(['post_id' => $GLOBALS['note'], 'count' => true, 'status' => 'all']);

$out = [];
// Signed out: the approved thread, a sign-in link, no form; the page stays shared.
$anon = fetch("$url/notes/open-note/");
$out['signed out'] = ['status' => $anon['status'], 'thread' => thread($anon['body']), 'forms' => count(forms($anon['body'])), 'sign in' => text($anon['body'], 'first-comments-sign-in'), 'cache' => $anon['headers']['cache-control'][0] ?? null];

// Signed out, each path refused, and nothing saved.
$before = $count();
$facade = fetch("$url/__first/api/v1/comments", 'POST', ['Content-Type: application/json'], json_encode(['on' => $note, 'content' => 'anon json']));
$form = post(['action' => '/__first/api/v1/comments', 'fields' => ['on' => (string) $note, '_first_return' => '/notes/open-note/']], 'anon form', []);
$core = fetch("$url/wp-comments-post.php", 'POST', ['Content-Type: application/x-www-form-urlencoded'], http_build_query(['comment_post_ID' => $note, 'comment' => 'anon core', 'author' => 'Anon', 'email' => 'anon@example.test']));
$out['signed out posts'] = [
    'facade' => $facade['status'],
    'form' => [$form['status'], text((string) $form['back']['body'], 'first-comments-error')],
    'core' => $core['status'],
    'saved' => $count() - $before,
];

// Ann, signed in, first comment: held, shown to her only.
$ann = $session('ann');
$page = fetch("$url/notes/open-note/", headers: $ann);
$top = forms($page['body'])[count(forms($page['body'])) - 1];
$first = post($top, 'Hello from Ann', $ann);
$annFirst = (int) get_comments(['post_id' => $note, 'search' => 'Hello from Ann', 'fields' => 'ids', 'status' => 'all'])[0];
$out['first comment'] = [
    'status' => $first['status'],
    'stored' => $status($annFirst),
    'notice' => text((string) $first['back']['body'], 'first-comments-held'),
    'ann sees' => thread((string) $first['back']['body']),
    'others see' => thread(fetch("$url/notes/open-note/")['body']),
    'bo sees' => thread(fetch("$url/notes/open-note/", headers: $session('bo'))['body']),
    'page cache' => $page['headers']['cache-control'][0] ?? null,
    'nonce' => isset($top['fields']['_wpnonce']),
];

// Once a moderator approves it, her next comment is approved at once; through the facade too.
wp_set_comment_status($annFirst, 'approve');
[$nonce, $cookie] = explode("\n", $nonceFor('ann'));
$second = fetch("$url/__first/api/v1/comments", 'POST', [$cookie, "X-WP-Nonce: $nonce", 'Content-Type: application/json'], json_encode(['on' => $note, 'content' => 'Ann again']));
$out['second comment'] = [$second['status'], json_decode($second['body'], true)['data']['status'] ?? $second['body']];
// Bo, first time, through core's wp-comments-post.php: held, as on every other path.
$bo = $session('bo');
$boPost = fetch("$url/wp-comments-post.php", 'POST', [...$bo, 'Content-Type: application/x-www-form-urlencoded'], http_build_query(['comment_post_ID' => $note, 'comment' => 'Bo via core']));
$boId = (int) (get_comments(['post_id' => $note, 'search' => 'Bo via core', 'fields' => 'ids', 'status' => 'all'])[0] ?? 0);
$out['core path'] = [$boPost['status'], $boId > 0 ? $status($boId) : null];

// Replies: depth 2 and 3 are taken; a reply to a depth-3 comment is refused on every path, and the
// page offers no reply form there.
$page = fetch("$url/notes/open-note/", headers: $ann);
$pageNonce = forms($page['body'])[0]['fields']['_wpnonce'];
$reply = static fn (int $parent): array => ['action' => '/__first/api/v1/comments', 'fields' => ['on' => (string) $note, 'parent' => (string) $parent, '_first_return' => '/notes/open-note/', '_wpnonce' => $pageNonce]];
post($reply($seeded), 'depth two', $ann);
$two = (int) get_comments(['post_id' => $note, 'search' => 'depth two', 'fields' => 'ids', 'status' => 'all'])[0];
post($reply($two), 'depth three', $ann);
$three = (int) get_comments(['post_id' => $note, 'search' => 'depth three', 'fields' => 'ids', 'status' => 'all'])[0];
$deep = post($reply($three), 'depth four', $ann);
$deepJson = fetch("$url/__first/api/v1/comments", 'POST', [$cookie, "X-WP-Nonce: $nonce", 'Content-Type: application/json'], json_encode(['on' => $note, 'parent' => $three, 'content' => 'depth four json']));
$deepCore = fetch("$url/wp-comments-post.php", 'POST', [...$ann, 'Content-Type: application/x-www-form-urlencoded'], http_build_query(['comment_post_ID' => $note, 'comment_parent' => $three, 'comment' => 'depth four core']));
$view = fetch("$url/notes/open-note/", headers: $ann)['body'];
$out['depth'] = [
    'form' => text((string) $deep['back']['body'], 'first-comments-error'),
    'facade' => $deepJson['status'],
    'core' => $deepCore['status'],
    'saved' => count(get_comments(['post_id' => $note, 'search' => 'depth four', 'fields' => 'ids', 'status' => 'all'])),
    'thread' => thread($view),
    'reply forms on' => array_values(array_map(static fn ($f) => (int) $f['fields']['parent'], array_filter(forms($view), static fn ($f) => isset($f['fields']['parent'])))),
    'depth three id' => $three,
];

// A draft note: no thread for a visitor who can't read it, and no comment on it either.
wp_insert_comment(['comment_post_ID' => $draft, 'comment_content' => 'Draft talk', 'comment_author' => 'admin', 'user_id' => 1, 'comment_approved' => 1]);
$draftPage = fetch("$url/notes/draft-note/", headers: $ann);
$draftList = fetch("$url/__first/api/v1/comments?post=$draft", headers: [$cookie, "X-WP-Nonce: $nonce"]);
$draftPost = fetch("$url/__first/api/v1/comments", 'POST', [$cookie, "X-WP-Nonce: $nonce", 'Content-Type: application/json'], json_encode(['on' => $draft, 'content' => 'on a draft']));
$out['draft'] = [
    'page' => $draftPage['status'],
    'page shows' => str_contains($draftPage['body'], 'Draft talk'),
    'list' => $draftList['status'] === 200 ? count(json_decode($draftList['body'], true)['data'] ?? []) : $draftList['status'],
    'post' => $draftPost['status'],
];
// A kind without comments refuses every path.
$memoPost = fetch("$url/__first/api/v1/comments", 'POST', [$cookie, "X-WP-Nonce: $nonce", 'Content-Type: application/json'], json_encode(['on' => $memo, 'content' => 'on a memo']));
$out['memo'] = $memoPost['status'];

// The page cache: what changes the approved thread purges the item's URL; what doesn't, doesn't.
// (A held comment, a spam one, approving one, unapproving it, editing an approved one, deleting it.)
global $wpdb;
$purged = static function (callable $event) use ($wpdb): array {
    // Each event on its own: what earlier steps of this long-lived process queued goes out first.
    \First\Wp\Purges::flush();
    $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name = 'test_purges'");
    wp_cache_delete('test_purges', 'options');
    wp_set_current_user(1);
    $event();
    \First\Wp\Purges::flush();
    wp_set_current_user(0);
    wp_cache_delete('test_purges', 'options');
    return array_values(array_filter((array) get_option('test_purges', []), static fn (string $p): bool => str_starts_with($p, '/notes/open-note')));
};
// A page at another address that rendered the note and its thread, cached for anonymous visitors:
// approving a comment purges it too. A page that only listed notes keeps its copy.
$featured = fetch("$url/featured");
$out['featured cache'] = $featured['headers']['cache-control'][0] ?? null;
$out['featured purged'] = (static function () use ($wpdb, $note, $url): array {
    \First\Wp\Purges::flush();
    $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name = 'test_purges'");
    wp_cache_delete('test_purges', 'options');
    wp_set_current_user(1);
    $id = (int) wp_insert_comment(['comment_post_ID' => $note, 'comment_content' => 'Seen on featured', 'comment_author' => 'x', 'comment_approved' => 0]);
    wp_set_comment_status($id, 'approve');
    \First\Wp\Purges::flush();
    wp_set_current_user(0);
    wp_cache_delete('test_purges', 'options');
    $all = (array) get_option('test_purges', []);
    return [in_array('/featured', $all, true), in_array('/notes/open-note/', $all, true)];
})();
$out['purges'] = [
    'held' => $purged(static function () use ($note, &$held): void {
        $held = (int) wp_insert_comment(['comment_post_ID' => $note, 'comment_content' => 'Held one', 'comment_author' => 'x', 'comment_approved' => 0]);
    }),
    'spam' => $purged(static fn () => wp_insert_comment(['comment_post_ID' => $note, 'comment_content' => 'Spam one', 'comment_author' => 'x', 'comment_approved' => 'spam'])),
    'approved' => $purged(static fn () => wp_set_comment_status($held, 'approve')),
    'edited' => $purged(static fn () => wp_update_comment(['comment_ID' => $held, 'comment_content' => 'Held one, edited'])),
    'unapproved' => $purged(static fn () => wp_set_comment_status($held, 'hold')),
    'edited while held' => $purged(static fn () => wp_update_comment(['comment_ID' => $held, 'comment_content' => 'Held again'])),
    'approved again' => $purged(static fn () => wp_set_comment_status($held, 'approve')),
    'deleted' => $purged(static fn () => wp_delete_comment($held, true)),
    'approved then spammed' => (static function () use ($purged, $note): array {
        $id = (int) wp_insert_comment(['comment_post_ID' => $note, 'comment_content' => 'Will be spam', 'comment_author' => 'admin', 'user_id' => 1, 'comment_approved' => 1]);
        \First\Wp\Purges::flush();
        return $purged(static fn () => wp_spam_comment($id));
    })(),
    'approved then trashed' => (static function () use ($purged, $note): array {
        $id = (int) wp_insert_comment(['comment_post_ID' => $note, 'comment_content' => 'Will be trashed', 'comment_author' => 'admin', 'user_id' => 1, 'comment_approved' => 1]);
        \First\Wp\Purges::flush();
        return $purged(static fn () => wp_trash_comment($id));
    })(),
    'edited and approved at once' => (static function () use ($purged, $note): array {
        $id = (int) wp_insert_comment(['comment_post_ID' => $note, 'comment_content' => 'Held, then both', 'comment_author' => 'x', 'comment_approved' => 0]);
        \First\Wp\Purges::flush();
        return $purged(static fn () => wp_update_comment(['comment_ID' => $id, 'comment_content' => 'Edited and approved', 'comment_approved' => 1]));
    })(),
    'control: a note edit' => $purged(static fn () => wp_update_post(['ID' => $note, 'post_title' => 'Open note'])),
    'approved on insert' => $purged(static fn () => wp_insert_comment(['comment_post_ID' => $note, 'comment_content' => 'Straight in', 'comment_author' => 'admin', 'user_id' => 1, 'comment_approved' => 1])),
];

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
$site->destroy();
