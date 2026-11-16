<?php

declare(strict_types=1);

namespace TypedPress;

/**
 * HTTP validators for what TypedPress serves as is (prebuilt pages, the OpenAPI document): a strong ETag
 * derived from the bytes served, and whether `If-None-Match` names it.
 *
 * matches() repeats the matcher in `Wp\PublicFiles::matches()` (`*`, a comma-separated list, weak
 * `W/"…"` forms) because that file belongs to the public-file serving branch and is not edited here.
 */
final class Validator
{
    /** The ETag of $bytes, the exact body sent (xxh128: 0.011 ms for 100 KB). */
    public static function bytes(string $bytes): string
    {
        return '"' . hash('xxh128', $bytes) . '"';
    }

    /**
     * The ETag of $handle's content, read in chunks (no whole-file buffer), with the handle rewound to
     * its start afterwards. Null, so a failed read never yields a usable tag, when a read fails or
     * returns nothing before the end, when the bytes read are not the $size the handle reported, or
     * when the rewind fails.
     *
     * @param resource $handle
     */
    public static function stream($handle, int $size): ?string
    {
        $context = hash_init('xxh128');
        $read = 0;
        while (!feof($handle)) {
            $chunk = fread($handle, 65536);
            if ($chunk === false || ($chunk === '' && !feof($handle))) {
                return null;
            }
            $read += strlen($chunk);
            if ($read > $size) {
                return null;
            }
            hash_update($context, $chunk);
        }
        if ($read !== $size || !rewind($handle)) {
            return null;
        }

        return '"' . hash_final($context) . '"';
    }

    /** Whether the request's `If-None-Match` names $etag; never for a missing tag (nothing read). */
    public static function matches(?string $etag): bool
    {
        if ($etag === null || $etag === '""') {
            return false;
        }
        $header = (string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '');
        // WordPress slashes $_SERVER (wp_magic_quotes), so an ETag's quotes arrive escaped.
        if (function_exists('wp_unslash')) {
            $header = (string) wp_unslash($header);
        }
        if (trim($header) === '*') {
            return true;
        }
        // Whole entity-tags, not comma-separated pieces: a comma (or a `*`) may be inside the quotes.
        preg_match_all('/(?:W\/)?"[^"]*"/', $header, $tags);
        foreach ($tags[0] as $tag) {
            if ((str_starts_with($tag, 'W/') ? substr($tag, 2) : $tag) === $etag) {
                return true;
            }
        }

        return false;
    }
}
