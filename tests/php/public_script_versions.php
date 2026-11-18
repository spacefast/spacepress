<?php

declare(strict_types=1);

require __DIR__ . '/wp.php';

function metadataScripts(string $html): array
{
    preg_match_all('#<script id="typedpress-app-script-[0-9a-f]+-js-module" src="([^"]*)" type="module">#', $html, $matches);
    return array_map('html_entity_decode', $matches[1]);
}

$site = wpSite('public-script-versions', ['wpContent' => $argv[1]]);
$site->startServer();
$base = $site->url();
$scripts = metadataScripts(file_get_contents("$base/"));
echo json_encode([
    'base' => $base,
    'scripts' => $scripts,
    'plain' => metadataScripts(file_get_contents("$base/plain/")),
    'body' => $scripts === [] ? null : file_get_contents($scripts[0]),
], JSON_THROW_ON_ERROR), "\n";
$site->destroy();
