<?php

declare(strict_types=1);

/** Disposable fixture assembly using the integrated runtime, without runtime source overrides. */
function servicesArtifact(): array
{
    $pipes = [];
    $child = proc_open([PHP_BINARY, '-d', 'memory_limit=512M', __FILE__, 'prepare'], [1 => ['pipe', 'w'], 2 => STDERR], $pipes);
    $result = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    if (proc_close($child) !== 0) {
        throw new RuntimeException('Services artifact assembly failed');
    }
    return json_decode(trim($result), true, 32, JSON_THROW_ON_ERROR);
}

function servicesRemoveArtifact(string $directory): void
{
    if (!preg_match('#^/tmp/typedpress-wp-services-artifact-[a-f0-9]{8}$#D', $directory)) {
        throw new RuntimeException('Refusing to remove an unowned artifact path');
    }
    exec('rm -rf -- ' . escapeshellarg($directory), $output, $status);
    if ($status !== 0 || is_dir($directory)) {
        throw new RuntimeException('Owned artifact cleanup failed');
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__ && ($argv[1] ?? '') === 'prepare') {
    require dirname(__DIR__, 2) . '/tests/php/wp.php';
    $schema = require dirname(__DIR__, 2) . '/tests/fixtures/blog/schema.php';
    $schema['collections']['posts']['columns']['excerpt']['access']['read'] = ['role' => 'anyone'];
    $schema['collections']['posts']['columns']['internal'] = ['type' => 'text', 'access' => ['read' => ['role' => 'editor']]];
    $schema['collections']['posts']['access']['read'] = ['fn' => 'services__read'];
    $functions = (string) file_get_contents(dirname(__DIR__, 2) . '/tests/fixtures/blog/functions.php');
    $functions .= "\nfunction services__read(\$ctx) { return ['title' => ['ne' => 'Internal workshop']]; }\n";
    $site = WpSite::create('services-artifact', ['schema' => $schema, 'functions' => $functions]);
    $plugins = json_decode((string) file_get_contents($site->dir . '/site.json'), true)['activate'];
    file_put_contents($site->content . '/typedpress-manifest.json', json_encode(['app' => $schema['name'], 'plugins' => array_fill_keys($plugins, [])], JSON_THROW_ON_ERROR));
    echo json_encode(['directory' => $site->dir, 'content' => $site->content], JSON_THROW_ON_ERROR), "\n";
}
