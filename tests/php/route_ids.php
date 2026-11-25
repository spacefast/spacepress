<?php

declare(strict_types=1);

/*
 * Stable route ids (tests/app_router.rs `route_ids_keep_pages_when_files_move`): the fixture
 * tests/fixtures/route-ids built twice, the second time with its page.tsx and page.md moved to new
 * folders, installed over the first on one WordPress site. Prints the Pages each build stored.
 *
 *   SP_WP_THEMES=1 php tests/php/route_ids.php <first wp-content> <second wp-content>
 */

require __DIR__ . '/wp.php';

$site = wpSite('route-ids', ['wpContent' => $argv[1]]);
$site->actAs(null);
$pages = static function (): array {
    \SpacePress\Wp\RoutePages::instance()?->reconcile();

    $out = [];
    foreach (get_posts(['post_type' => 'page', 'post_status' => ['publish', 'private', 'draft', 'trash'], 'numberposts' => -1, 'orderby' => 'ID', 'order' => 'ASC', 'suppress_filters' => true]) as $post) {
        $route = get_post_meta($post->ID, '_sp_route', true);
        if ($route !== '') {
            $out[$post->post_title] = ['id' => $post->ID, 'status' => $post->post_status, 'link' => wp_make_link_relative(get_permalink($post))];
        }
    }
    ksort($out);
    return $out;
};
$site->startServer();
$url = $site->url();
$get = static fn (string $path): int => (int) (function () use ($url, $path) { $ch = curl_init($url . $path); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true]); curl_exec($ch); return curl_getinfo($ch, CURLINFO_RESPONSE_CODE); })();
// A request stores the build's Pages: code Pages and page.md Pages alike.
$out = ['first served' => [$get('/about/'), $get('/colophon/')]];
$out['first'] = $pages();
$app = glob($site->dir . '/content/plugins/spacepress-app-*')[0];
$site->stopServer();
exec('rm -rf ' . escapeshellarg($app));
wpCopy($argv[2] . '/plugins/' . basename($app), $app);
$site->startServer();
$url = $site->url();
$out['second served'] = [$get('/company/about/'), $get('/company/colophon/'), $get('/about/'), $get('/colophon/')];
// The links as the second build gives them: read by the server, which loaded that build.
$out['second'] = $pages();
foreach ($out['second'] as $title => $page) {
    $ch = curl_init($url . '/?page_id=' . $page['id']);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true]);
    curl_exec($ch);
    $out['second'][$title]['link'] = wp_make_link_relative((string) curl_getinfo($ch, CURLINFO_REDIRECT_URL));
}
echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
$site->destroy();
