<?php

declare(strict_types=1);

require __DIR__ . '/wp.php';

function metadataScripts(string $html): array
{
    preg_match_all('#<script id="typedpress-app-script-[0-9a-f]+-js-module" src="([^"]*)" type="module">#', $html, $matches);
    return array_map('html_entity_decode', $matches[1]);
}

function moduleResponse(string $url, bool $managed = false, string $method = 'GET', ?string $conditional = null): array
{
    $headers = $managed ? ['X-TP-Test-Managed: 1'] : [];
    if ($conditional !== null) {
        $headers[] = 'If-None-Match: ' . $conditional;
    }
    $out = [];
    $c = curl_init($url);
    curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_NOBODY => $method === 'HEAD', CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 30, CURLOPT_HEADERFUNCTION => static function ($c, string $line) use (&$out): int {
            if (str_contains($line, ':')) {
                [$name, $value] = explode(':', $line, 2);
                $out[strtolower($name)] = trim($value);
            }
            return strlen($line);
        }]);
    $body = curl_exec($c);
    return [curl_getinfo($c, CURLINFO_RESPONSE_CODE), $out, $body];
}

// Boot and initialize the loose copy normally. Requests with the fixture header mount the
// immutable compiler output through the real Loader instead of activating the loose plugins.
$mount = sprintf(<<<'PHP'
    <?php
    if (!isset($_SERVER['HTTP_X_TP_TEST_MANAGED'])) {
        return;
    }
    add_filter('option_active_plugins', static fn (array $plugins): array => array_values(array_filter(
        $plugins, static fn (string $plugin): bool => !str_starts_with($plugin, 'typedpress-'),
    )));
    $root = %s;
    require $root . '/runtime/' . %s . '/typedpress-loader.php';
    \TypedPress\Loader\Loader::load($root, %s);
    header_register_callback(static function (): void {
        foreach (get_included_files() as $file) {
            if (str_ends_with($file, '/tp/app/functions.php')) {
                header('X-Test-App-Code-Loaded: 1');
                break;
            }
        }
    });
    PHP, var_export($argv[2], true), var_export($argv[3], true), var_export($argv[4], true));
$site = wpSite('public-script-versions', ['wpContent' => $argv[1], 'muPlugins' => ['managed-preview' => $mount]]);
$site->startServer();
$base = $site->url();
$scripts = metadataScripts(file_get_contents("$base/"));
$loose = moduleResponse($scripts[0]);
$body = $loose[2];
$digest = hash('sha256', $body);
$etag = '"sha256-' . $digest . '"';
$long = 'public, max-age=31536000, s-maxage=300, immutable';
$short = 'public, max-age=300';
$bare = "$base/scripts/module%20name.mjs";
$check = static function (array $response, int $status, string $cache, string $body, ?string $etag = null, ?string $length = null): void {
    if ($response[0] !== $status || ($response[1]['cache-control'] ?? null) !== $cache || $response[2] !== $body
        || isset($response[1]['x-test-app-code-loaded'])
        || ($etag !== null && ($response[1]['etag'] ?? null) !== $etag)
        || ($length !== null && ($response[1]['content-length'] ?? null) !== $length)) {
        throw new RuntimeException('Unexpected module response: ' . json_encode($response, JSON_THROW_ON_ERROR));
    }
};
$check($loose, 200, $short, $body);
$check(moduleResponse($scripts[0], true), 200, $long, $body, $etag, (string) strlen($body));
$check(moduleResponse($scripts[0], true, 'HEAD'), 200, $long, '', $etag, (string) strlen($body));
$check(moduleResponse($scripts[0], true, 'GET', 'W/' . $etag), 304, $long, '', $etag);
$check(moduleResponse($bare, true), 200, $short, $body);
$wrong = $argv[5] === '' ? str_repeat('0', 64) : $argv[5];
foreach (["tpv=$wrong", "tpv=$digest&tpv=$wrong", "tpv=$digest&%74pv=$digest", "tpv=$digest&tpv%5B%5D=$digest", "tpv=$digest&mode=a;tpv=$wrong", 'tpv=' . substr($digest, 0, 16)] as $query) {
    $check(moduleResponse("$bare?$query", true), 200, $short, $body);
}
$check(moduleResponse("$base/notes.txt?tpv=$digest", true), 200, $short, $body);
echo json_encode([
    'base' => $base,
    'scripts' => $scripts,
    'plain' => metadataScripts(file_get_contents("$base/plain/")),
    'body' => $body,
], JSON_THROW_ON_ERROR), "\n";
$site->destroy();
