<?php

declare(strict_types=1);

/*
 * A 0.3.0 app's `routes` after its stored `zero.source-bundle.v1` is recompiled
 * (tests/zero_bundle.rs `a_recompiled_zero_bundle_serves_its_routes_as_0_3_did`): the compiled
 * tree's plugins installed on WordPress, served by php -S with the theme front end on. Prints one
 * JSON object: label => [status, body].
 *
 *   TP_WP_THEMES=1 php tests/php/zero_routes.php <compiled tree>
 *
 * The tree is compiled with no previous output, so a fresh site gets TypedPress's table names (a site
 * that ran 0.3.0 gets them from the stored-name upgrade, tests/wp/zero-upgrade).
 */

require __DIR__ . '/wp.php';

// The compiled tree lays its plugins out as `typedpress build` does; the harness reads their order
// from the manifest a build writes beside them.
$content = sys_get_temp_dir() . '/typedpress-zero-routes-' . bin2hex(random_bytes(4));
wpCopy($argv[1] . '/plugins', "$content/plugins");
$manifest = json_decode((string) file_get_contents($argv[1] . '/manifest.json'), true, 512, JSON_THROW_ON_ERROR);
// The host provides the platform plugins; the tests' pins stand in for them.
$plugins = [];
$platform = json_decode((string) file_get_contents(dirname(__DIR__) . '/fixtures/platform.json'), true, 512, JSON_THROW_ON_ERROR);
foreach ($platform['plugins'] as $slug => $pin) {
    if ($slug !== 'polylang') {
        wpCopy(wpPlugin($slug, $pin['version'], $pin['sha256']), "$content/plugins/$slug");
        $plugins[$slug] = $pin['version'];
    }
}
foreach (['typedpress-runtime', 'typedpress-app-' . $manifest['app']] as $slug) {
    $plugins[$slug] = '';
}
file_put_contents("$content/typedpress-manifest.json", json_encode(['app' => $manifest['app'], 'plugins' => $plugins], JSON_THROW_ON_ERROR));
$site = wpSite('zero-routes', ['wpContent' => $content, 'users' => ['chief' => 'editor', 'reader' => 'subscriber'],
    'muPlugins' => ['secret' => "<?php define('ROUTES_SECRET', 'route-secret');"]]);
register_shutdown_function(static fn () => exec('rm -rf ' . escapeshellarg($content)));
[$code, $migrated] = $site->wpCli(['migrate']);
if ($code !== 0) {
    throw new RuntimeException('migrate failed: ' . json_encode($migrated));
}
wp_set_current_user(1);
\TypedPress\db()->insert('notes', ['title' => 'Published', 'status' => 'published']);
\TypedPress\db()->insert('notes', ['title' => 'Draft', 'status' => 'draft']);
$site->actAs(null);
$site->startServer();
$url = $site->url();

function fetch(string $url, string $method = 'GET', array $headers = [], ?string $body = null): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => $headers, CURLOPT_POSTFIELDS => $body,
    ]);
    $text = (string) curl_exec($ch);
    return [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), $text];
}

$session = static function (string $user) use ($site): array {
    $id = $site->userId($user);
    $expires = time() + 3600;
    $token = WP_Session_Tokens::get_instance($id)->create($expires);
    $cookie = wp_generate_auth_cookie($id, $expires, 'logged_in', $token);
    $_COOKIE[LOGGED_IN_COOKIE] = $cookie;
    wp_set_current_user($id);
    $nonce = wp_create_nonce('wp_rest');
    wp_set_current_user(0);
    unset($_COOKIE[LOGGED_IN_COOKIE]);
    return ['Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode($cookie), 'X-WP-Nonce: ' . $nonce];
};
$body = 'payload';
$t = (string) time();
$signed = 't=' . $t . ',v1=' . hash_hmac('sha256', $t . '.' . $body, 'route-secret');
$home = fetch("$url/");

echo json_encode([
    'feed' => fetch("$url/api/feed.json"),
    'feed limit' => fetch("$url/api/feed.json?limit=1"),
    'literal' => fetch("$url/api/notes/latest"),
    'param' => fetch("$url/api/notes/7"),
    'post anonymous' => fetch("$url/api/notes/7", 'POST'),
    'post editor' => fetch("$url/api/notes/7", 'POST', $session('chief')),
    'wrong method' => fetch("$url/api/feed.json", 'DELETE'),
    'rest anonymous' => fetch("$url/files/a/b"),
    'rest signed in' => fetch("$url/files/a/b", 'GET', $session('reader')),
    'signed' => fetch("$url/webhooks/in", 'POST', ['x-signature: ' . $signed], $body),
    'unsigned' => fetch("$url/webhooks/in", 'POST', [], $body),
    'home' => [$home[0], str_contains($home[1], 'wp-block') || str_contains($home[1], '<body')],
    'unrouted' => [fetch("$url/no-such-page")[0], null],
], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES), "\n";
