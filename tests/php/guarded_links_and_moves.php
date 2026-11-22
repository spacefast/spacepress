<?php

declare(strict_types=1);

require __DIR__ . '/wp.php';

$site = wpSite('guard-boundaries', ['wpContent' => $argv[1], 'muPlugins' => ['cache' => <<<'PHP'
    <?php
    function batcache_cancel(): void { header('X-Test-Batcache-Cancel: yes'); }
    add_filter('login_url', static function (string $login, string $back): string {
        return isset($_SERVER['HTTP_X_TEST_SPLIT_SIGN_IN'])
            ? add_query_arg('redirect_to', urlencode($back), 'https://auth.example.test/login')
            : $login;
    }, 10, 2);
    PHP]]);
wp_set_current_user(1);
$db = \TypedPress\db();
$db->insert('notes', ['title' => 'Renamed note', 'slug' => 'old-note', 'status' => 'published']);
$id = (int) $db->findFirst('notes', ['where' => ['slug' => 'old-note']])['id'];
$db->update('notes', ['slug' => 'new-note'], ['id' => $id]);
$site->actAs(null);
$site->startServer();
$url = $site->url();

$html = (string) file_get_contents("$url/links/");
$doc = new DOMDocument();
@$doc->loadHTML($html);
$links = [];
foreach ((new DOMXPath($doc))->query('//main//a') as $link) {
    $links[trim($link->textContent)] = [
        $link->getAttribute('href'),
        $link->hasAttribute('data-wp-on--click'),
        $link->hasAttribute('data-wp-on--mouseenter'),
    ];
}
$expected = [
    'Search' => ["$url/?s=drives", false, false],
    'Post' => ["$url/?p=1#article", false, false],
    'Feed' => ["$url/?feed=rss2", false, false],
    'App' => [add_query_arg('redirect_to', urlencode("$url/?view=compact#section"), "$url/wp-login.php"), false, false],
];
if ($links !== $expected) {
    throw new RuntimeException('Unexpected home links: ' . json_encode($links, JSON_THROW_ON_ERROR));
}

$ch = curl_init("$url/notes/old-note/");
$headers = [];
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
    CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$headers): int {
        if (str_starts_with($line, 'HTTP/')) {
            $headers = [];
        } elseif (str_contains($line, ':')) {
            [$name, $value] = explode(':', $line, 2);
            $headers[strtolower($name)][] = trim($value);
        }
        return strlen($line);
    },
]);
$response = curl_exec($ch);
$directives = array_map('trim', explode(',', strtolower(implode(',', $headers['cache-control'] ?? []))));
if ($response === false || curl_getinfo($ch, CURLINFO_RESPONSE_CODE) !== 301
    || ($headers['location'] ?? []) !== ["$url/notes/new-note/"]
    || !in_array('private', $directives, true)
    || !in_array('no-store', $directives, true)
    || ($headers['x-test-batcache-cancel'] ?? []) !== ['yes']) {
    throw new RuntimeException('Unexpected guarded redirect: ' . json_encode($headers));
}
// A whole batch of newer posts may have no eligible twin. The older public post and its
// archive must still be discoverable. Use the site's guarded kind route for those permalinks.
curl_setopt_array($ch, [CURLOPT_URL => "$url/?view=compact", CURLOPT_HTTPHEADER => ['X-Test-Split-Sign-In: yes']]);
$expectedSignIn = add_query_arg('redirect_to', urlencode("$url/?view=compact"), 'https://auth.example.test/login');
if (curl_exec($ch) === false || curl_getinfo($ch, CURLINFO_RESPONSE_CODE) !== 302 || ($headers['location'] ?? []) !== [$expectedSignIn]) {
    throw new RuntimeException('Guard lost the configured sign-in host or return URL: ' . json_encode($headers));
}

$public = wp_insert_post(['post_type' => 'post', 'post_status' => 'publish', 'post_title' => 'Public directory record', 'post_date' => '2020-01-01 12:00:00']);
$archive = wp_insert_post(['post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Directory archive']);
update_option('show_on_front', 'page');
update_option('page_for_posts', $archive);
for ($i = 0; $i < \TypedPress\Wp\MarkdownTwins::LLMS_LIMIT; ++$i) {
    wp_insert_post(['post_type' => 'post', 'post_status' => 'publish', 'post_title' => "Hidden record $i"]);
}
$guardedPosts = static fn (string $url, WP_Post $post): string =>
    str_starts_with($post->post_title, 'Hidden record') ? home_url('/notes/' . $post->post_name . '/') : $url;
add_filter('post_link', $guardedPosts, 10, 2);
$llms = \TypedPress\Wp\MarkdownTwins::llms();
if (!str_contains($llms, '[Public directory record]') || !str_contains($llms, '[All Posts]') || str_contains($llms, 'Hidden record')) {
    throw new RuntimeException('llms.txt lost an eligible post or exposed a guarded entry.');
}

add_filter('pre_option_permalink_structure', static fn () => '', PHP_INT_MAX);
$plain = \TypedPress\Wp\MarkdownTwins::twin(get_permalink($public));
$llms = \TypedPress\Wp\MarkdownTwins::llms();
if (!str_contains($plain, '?p=' . $public) || !str_contains($llms, "[Public directory record]($plain)") || str_contains($llms, 'the home page is')) {
    throw new RuntimeException('Plain-permalink posts must remain discoverable while the actual home stays guarded.');
}
// Even when guards reject every candidate, discovery bounds the work per post type.
for ($i = 100; $i < 301; ++$i) {
    wp_insert_post(['post_type' => 'post', 'post_status' => 'publish', 'post_title' => "Hidden record $i"]);
}
$batches = [];
add_action('pre_get_posts', static function (WP_Query $query) use (&$batches): void {
    if ($query->get('post_type') === 'post' && $query->get('posts_per_page') === 100) {
        $batches[] = $query->get('paged');
    }
});
$llms = \TypedPress\Wp\MarkdownTwins::llms();
if ($batches !== [1, 2, 3] || str_contains($llms, 'Hidden record') || str_contains($llms, '[Public directory record]')) {
    throw new RuntimeException('Guarded listings must stop after three batches: ' . json_encode($batches));
}
$site->destroy();
