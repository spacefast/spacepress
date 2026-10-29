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
finish('vendor_drift');
