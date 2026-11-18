<?php

declare(strict_types=1);

require __DIR__ . '/wp.php';

$site = wpSite('guard-boundaries', ['wpContent' => $argv[1], 'muPlugins' => ['cache' => <<<'PHP'
    <?php
    function batcache_cancel(): void { header('X-Test-Batcache-Cancel: yes'); }
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
    'App' => [wp_login_url("$url/?view=compact#section"), false, false],
];
if ($links !== $expected) {
    throw new RuntimeException('Unexpected home links: ' . json_encode($links, JSON_THROW_ON_ERROR));
}

$ch = curl_init("$url/notes/old-note/");
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_TIMEOUT => 30]);
$response = (string) curl_exec($ch);
preg_match('/^cache-control:\h*([^\r\n]+)/im', $response, $cache);
$directives = array_map('trim', explode(',', strtolower($cache[1] ?? '')));
if (curl_getinfo($ch, CURLINFO_RESPONSE_CODE) !== 301
    || !str_contains(strtolower($response), 'location: ' . strtolower("$url/notes/new-note/"))
    || !in_array('private', $directives, true)
    || !in_array('no-store', $directives, true)
    || !str_contains(strtolower($response), 'x-test-batcache-cancel: yes')) {
    throw new RuntimeException('Guarded item redirect was not private: ' . $response);
}
$site->destroy();
