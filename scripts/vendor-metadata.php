<?php
declare(strict_types=1);
$root = $argv[1];
$lock = json_decode(file_get_contents($root . '/composer.lock'), true, 512, JSON_THROW_ON_ERROR);
// Strauss creates a temporary Composer project without a lock, so Composer
// chooses a random loader suffix. Give this isolated bundle a stable identity.
foreach (['autoload.php', 'composer/autoload_real.php', 'composer/autoload_static.php'] as $relative) {
    $file = $root . '/vendor-prefixed/' . $relative;
    file_put_contents($file, preg_replace('/(Composer(?:Autoloader|Static)Init)[a-f0-9]{32}/', '${1}ZeroRuntime', file_get_contents($file)));
}
$autoload = $root . '/vendor-prefixed/composer/autoload_real.php';
file_put_contents($autoload, str_replace('__composer_autoload_files', '__zero_runtime_vendor_autoload_files', file_get_contents($autoload)));
// The bundle root is a build helper, not an installed dependency. Composer's
// inferred branch and commit must not make its metadata depend on the checkout.
$installed = $root . '/vendor-prefixed/composer/installed.php';
[$rootMetadata, $dependencies] = explode("  'versions' =>", file_get_contents($installed), 2);
$rootMetadata = preg_replace(
    ["/'pretty_version' => '[^']*'/", "/'version' => '[^']*'/", "/'reference' => (?:NULL|'[^']*')/"],
    ["'pretty_version' => '1.0.0+no-version-set'", "'version' => '1.0.0.0'", "'reference' => NULL"],
    $rootMetadata,
);
file_put_contents($installed, $rootMetadata . "  'versions' =>" . $dependencies);
$licenses = [];
$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root . '/vendor-prefixed', FilesystemIterator::SKIP_DOTS));
foreach ($iterator as $file) {
    if ($file->isFile() && preg_match('/^(?:licen[cs]e|copying|copyright|notice)(?:[._-].*)?$/i', $file->getFilename())) {
        $licenses[] = substr($file->getPathname(), strlen($root . '/vendor-prefixed/')) . "\n" . file_get_contents($file->getPathname());
    }
}
sort($licenses, SORT_STRING);
file_put_contents($root . '/vendor-prefixed/THIRD-PARTY-LICENSES.txt', implode("\n\n---\n\n", $licenses));
file_put_contents($root . '/vendor-prefixed/.manifest.json', json_encode(['lock' => hash_file('sha256', $root . '/composer.lock'), 'strauss' => '0.31.1', 'php' => '8.2'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
