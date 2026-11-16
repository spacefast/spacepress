<?php
declare(strict_types=1);
require __DIR__ . '/harness.php';
foreach (['TypedPress', 'identity'] as $name) {
    $root = __DIR__ . '/../../runtime/' . $name;
    if (!is_file($root . '/composer.json')) {
        continue;
    }
    $manifest = json_decode(file_get_contents($root . '/vendor-prefixed/.manifest.json'), true, 512, JSON_THROW_ON_ERROR);
    eq($name . ' vendor lock is current', $manifest['lock'], hash_file('sha256', $root . '/composer.lock'));
    eq($name . ' vendor toolchain is pinned', [$manifest['strauss'], $manifest['php']], ['0.31.1', '8.2']);
}
// The identity screens' committed bundles must come from the committed sources (apps/build.mjs).
$apps = __DIR__ . '/../../runtime/identity/apps';
if (is_dir($apps)) {
    $lines = [];
    $files = new RecursiveIteratorIterator(new RecursiveCallbackFilterIterator(
        new RecursiveDirectoryIterator($apps, FilesystemIterator::SKIP_DOTS),
        static fn (SplFileInfo $f) => $f->getFilename() !== 'node_modules',
    ));
    foreach ($files as $file) {
        $lines[substr($file->getPathname(), strlen($apps) + 1)] = hash_file('sha256', $file->getPathname());
    }
    ksort($lines, SORT_STRING);
    $digest = hash('sha256', implode('', array_map(static fn ($path, $hash) => "$hash  $path\n", array_keys($lines), $lines)));
    $built = json_decode(file_get_contents(__DIR__ . '/../../runtime/identity/build/.manifest.json'), true, 512, JSON_THROW_ON_ERROR);
    eq('identity screens are built from the committed sources (cd runtime/identity/apps && node build.mjs)', $built['sources'], $digest);
}
// The admin screens' committed bundle must come from the committed sources (apps/build.mjs), and
// its licence bundle must name every notice that lives in the workspace itself.
$adminApps = __DIR__ . '/../../runtime/admin/apps';
if (is_dir($adminApps)) {
    $lines = [];
    // Skips what the workspace's .gitignore skips (generated trees and files), as build.mjs does.
    $generated = static fn (string $name) => in_array($name, ['node_modules', '.tsout', 'build', '.build-meta.json'], true) || str_ends_with($name, '.tsbuildinfo');
    $files = new RecursiveIteratorIterator(new RecursiveCallbackFilterIterator(
        new RecursiveDirectoryIterator($adminApps, FilesystemIterator::SKIP_DOTS),
        static fn (SplFileInfo $f) => !$generated($f->getFilename()) && !$f->isLink() && ($f->isDir() || $f->isFile()),
    ));
    $notices = [];
    foreach ($files as $file) {
        $rel = substr($file->getPathname(), strlen($adminApps) + 1);
        $lines[$rel] = hash_file('sha256', $file->getPathname());
        $top = strtok($rel, '/');
        if (in_array($top, ['packages', 'routes', 'fields'], true) && preg_match('/^(LICEN[CS]E|COPYING|NOTICE)(\\b|[.\\-_])/i', $file->getFilename())) {
            $notices[] = $rel;
        }
    }
    ksort($lines, SORT_STRING);
    $digest = hash('sha256', implode('', array_map(static fn ($path, $hash) => "$hash  $path\n", array_keys($lines), $lines)));
    $built = json_decode(file_get_contents(__DIR__ . '/../../runtime/admin/build/.manifest.json'), true, 512, JSON_THROW_ON_ERROR);
    eq('admin screens are built from the committed sources (cd runtime/admin/apps && pnpm build)', $built['sources'], $digest);
    $bundle = file_get_contents(__DIR__ . '/../../runtime/admin/build/THIRD-PARTY-LICENSES.txt');
    sort($notices);
    eq('admin licence bundle names every workspace notice', array_values(array_filter($notices, static fn ($n) => !str_contains($bundle, "\n$n\n") && !str_starts_with($bundle, "$n\n"))), []);
}
// Another plugin can own the bundled libraries' original names before TypedPress loads.
// The bundled Markdown, YAML and merger must still run through their private names,
// on WordPress core's own HTML API, which the bundle no longer copies.
eval('namespace Symfony\Component\Yaml; final class Yaml {}');
eval('namespace League\CommonMark; final class CommonMarkConverter {}');
eval('namespace WordPress\Merge; final class MergeStrategy {}');
require __DIR__ . '/wp.php';
wpCoreHtmlApi();
require __DIR__ . '/../../runtime/TypedPress/bootstrap.php';
$document = (new \TypedPress\Vendor\WordPress\Markdown\MarkdownConsumer("---\ntitle: Proof\n---\n# Hello\n\nWorld\n"))->consume();
eq('isolated Markdown and nested YAML preserve front matter', $document->get_all_metadata(), ['title' => ['Proof']]);
eq('isolated Markdown produces blocks on core\'s HTML API', $document->get_block_markup(), "<!-- wp:heading {\"level\":1} -->\n<h1 class=\"wp-block-heading\" id=\"hello\">Hello</h1>\n<!-- /wp:heading -->\n\n<!-- wp:paragraph -->\n<p>World</p>\n<!-- /wp:paragraph -->\n\n");
eq('the bundled toolkit loaded no HTML API of its own', array_values(array_filter(get_included_files(), static fn (string $f): bool => str_contains($f, '/vendor-prefixed/') && str_contains($f, 'class-wp-html'))), []);
$merge = new \TypedPress\Vendor\WordPress\Merge\MergeStrategy(new \TypedPress\Vendor\WordPress\Merge\Diff\LineDiffer(), new \TypedPress\Vendor\WordPress\Merge\Merge\LineMerger());
$result = $merge->merge("a\nb\nc\n", "A\nb\nc\n", "a\nb\nC\n");
eq('bundled merge combines independent edits', [$result->has_conflicts(), $result->get_merged_content()], [false, "A\nb\nC\n\n"]);
// The identity bundle runs its own JWT and TOTP copies while the original names are occupied.
eval('namespace Firebase\JWT; final class JWT {}');
eval('namespace OTPHP; final class TOTP {}');
require __DIR__ . '/../../runtime/identity/vendor-prefixed/autoload.php';
$rsa = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
openssl_pkey_export($rsa, $pem);
$jwt = \TypedPress\Identity\Vendor\Firebase\JWT\JWT::encode(['sub' => '1', 'exp' => time() + 60], $pem, 'RS256', 'k');
$claims = \TypedPress\Identity\Vendor\Firebase\JWT\JWT::decode($jwt, ['k' => new \TypedPress\Identity\Vendor\Firebase\JWT\Key(openssl_pkey_get_details($rsa)['key'], 'RS256')]);
eq('isolated php-jwt signs and verifies RS256', $claims->sub, '1');
$totp = \TypedPress\Identity\Vendor\OTPHP\TOTP::generate();
check('isolated otphp verifies its own code', $totp->verify($totp->now()));
finish('vendor_drift');
