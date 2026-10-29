<?php
declare(strict_types=1);
require __DIR__ . '/harness.php';
foreach (['Zero', 'identity'] as $name) {
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
// Another plugin can own these names before Zero loads. The real bundled
// parser and YAML implementation must still run through their private names.
eval('namespace Symfony\Component\Yaml; final class Yaml {}');
class WP_HTML_Tag_Processor {}
require __DIR__ . '/../../runtime/Zero/bootstrap.php';
$document = (new \Zero\Vendor\WordPress\Markdown\MarkdownConsumer("---\ntitle: Proof\n---\n# Hello\n\nWorld\n"))->consume();
eq('isolated Markdown and nested YAML preserve front matter', $document->get_all_metadata(), ['title' => ['Proof']]);
eq('isolated HTML and Markdown produce blocks', $document->get_block_markup(), "<!-- wp:heading {\"level\":1} -->\n<h1 class=\"wp-block-heading\" id=\"hello\">Hello</h1>\n<!-- /wp:heading -->\n\n<!-- wp:paragraph -->\n<p>World</p>\n<!-- /wp:paragraph -->\n\n");
$merge = new \Zero\Vendor\WordPress\Merge\MergeStrategy(new \Zero\Vendor\WordPress\Merge\Diff\LineDiffer(), new \Zero\Vendor\WordPress\Merge\Merge\LineMerger());
$result = $merge->merge("a\nb\nc\n", "A\nb\nc\n", "a\nb\nC\n");
eq('bundled merge combines independent edits', [$result->has_conflicts(), $result->get_merged_content()], [false, "A\nb\nC\n\n"]);
// The identity bundle runs its own JWT and TOTP copies while the original names are occupied.
eval('namespace Firebase\JWT; final class JWT {}');
eval('namespace OTPHP; final class TOTP {}');
require __DIR__ . '/../../runtime/identity/vendor-prefixed/autoload.php';
$rsa = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
openssl_pkey_export($rsa, $pem);
$jwt = \Zero\Identity\Vendor\Firebase\JWT\JWT::encode(['sub' => '1', 'exp' => time() + 60], $pem, 'RS256', 'k');
$claims = \Zero\Identity\Vendor\Firebase\JWT\JWT::decode($jwt, ['k' => new \Zero\Identity\Vendor\Firebase\JWT\Key(openssl_pkey_get_details($rsa)['key'], 'RS256')]);
eq('isolated php-jwt signs and verifies RS256', $claims->sub, '1');
$totp = \Zero\Identity\Vendor\OTPHP\TOTP::generate();
check('isolated otphp verifies its own code', $totp->verify($totp->now()));
finish('vendor_drift');
