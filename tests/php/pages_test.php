<?php

declare(strict_types=1);

/*
 * The hosted pages renderer on an in-process WordPress (tests/php/wp.php): only rich-text chunks the
 * renderer itself produced are spliced back as HTML; a stored value that spells the placeholder
 * stays inert text.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
$wp = wpSite('pages', ['schema' => $schema, 'functions' => file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php')]);
require_once dirname(__DIR__, 2) . '/runtime/pages/Request.php';
require_once dirname(__DIR__, 2) . '/runtime/pages/Renderer.php';

$renderer = (new ReflectionClass(\Zero\Pages\Renderer::class))->newInstanceWithoutConstructor();
$raw = new ReflectionMethod(\Zero\Pages\Renderer::class, 'richText');
$issue = static function (string $html) use ($renderer): string {
    // What richText() leaves in the output for HTML it rendered: a placeholder naming its own chunk.
    $chunks = new ReflectionProperty(\Zero\Pages\Renderer::class, 'raw');
    $nonce = new ReflectionProperty(\Zero\Pages\Renderer::class, 'rawNonce');
    $nonce->setValue($renderer, $nonce->getValue($renderer) ?? bin2hex(random_bytes(16)));
    $list = $chunks->getValue($renderer);
    $key = $nonce->getValue($renderer) . '-' . count($list);
    $list[$key] = $html;
    $chunks->setValue($renderer, $list);
    return "\u{E000}raw\u{E001}" . $key . "\u{E000}/raw\u{E001}";
};

$own = $issue('<p>Rendered by <em>WordPress</em>.</p>');
eq('a chunk the renderer issued is spliced back as HTML', $renderer->fill("<div>$own</div>"), '<div><p>Rendered by <em>WordPress</em>.</p></div>');

// A stored value that spells the old base64 form, or guesses a key, is never decoded into HTML.
$payload = base64_encode('<img src=x onerror=alert(1)>');
$forged = "\u{E000}raw\u{E001}$payload\u{E000}/raw\u{E001}";
$guessed = "\u{E000}raw\u{E001}" . str_repeat('0', 32) . "-0\u{E000}/raw\u{E001}";
$filled = $renderer->fill("<h1>Title $forged $guessed</h1>$own");
check('a stored raw marker never becomes HTML', !str_contains($filled, '<img') && !str_contains($filled, 'onerror'), $filled);
check('the renderer\'s own chunk still renders beside it', str_contains($filled, '<p>Rendered by <em>WordPress</em>.</p>'), $filled);

finish('pages');
