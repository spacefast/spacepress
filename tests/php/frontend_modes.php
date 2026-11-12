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

$site = wpSite('modes', ['wpContent' => $argv[1]]);
wp_set_current_user(1);
// WordPress's own sample post, so "a post the theme renders" exists in every mode.
$hello = get_post(1);
$note = \First\db()->insert('notes', ['title' => 'Hello note', 'slug' => 'hello-note', 'body' => '<!-- wp:paragraph --><p>Body text.</p><!-- /wp:paragraph -->', 'status' => 'published'])[0] ?? null;
$draft = \First\db()->insert('notes', ['title' => 'Draft note', 'slug' => 'draft-note', 'status' => 'draft']);
$entry = \First\db()->insert('journal', ['title' => 'Day one', 'slug' => 'day-one', 'status' => 'published', 'publishedAt' => '2026-03-04T10:00:00.000Z']);
$noteId = (int) (\First\db()->findFirst('notes', ['where' => ['slug' => 'hello-note']])['id']);
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
$out = [
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
// A slug change: the old URL 301s to the new one.
wp_set_current_user(1);
\First\db()->update('notes', ['slug' => 'renamed-note'], ['id' => $noteId]);
$site->actAs(null);
$old = $got('/notes/hello-note/');
$out['renamed'] = [$old['status'], $strip($old['location'])];
$out['new url'] = $got('/notes/renamed-note/')['status'];
echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
$site->destroy();
