<?php

declare(strict_types=1);

namespace Zero\Sync;

use Zero\HttpError;

/**
 * The `.html` escape hatch (§5.2): push stores the HTML as-is (one classic block); pull drops the block
 * delimiters, which is lossless only when every block is static, i.e. its saved markup holds its whole
 * output. A dynamic block (`<!-- wp:latest-posts /-->`) renders on the server from attributes alone and
 * would vanish, so it is refused by name.
 */
final class Html
{
    public static function strip(string $blocks): string
    {
        if (trim($blocks) === '') {
            return '';
        }
        Blocks::boot();
        $html = '';
        foreach (Blocks::parse($blocks) as $block) {
            self::requireStatic($block);
            $html .= Blocks::innerHtml($block);
        }

        return trim($html);
    }

    public static function fromHtml(string $html): string
    {
        return str_replace(["\r\n", "\r"], "\n", $html);
    }

    private static function requireStatic(array $block): void
    {
        $name = $block['blockName'] ?? null;
        if (is_string($name) && trim(implode('', array_filter($block['innerContent'] ?? [], 'is_string'))) === '' && ($block['innerBlocks'] ?? []) === []) {
            throw new HttpError(422, 'not_representable', "$name renders on the server and can't be written as HTML");
        }
        foreach ($block['innerBlocks'] ?? [] as $inner) {
            self::requireStatic($inner);
        }
    }
}
