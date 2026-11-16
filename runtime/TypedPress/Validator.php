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
        foreach (explode(',', $header) as $tag) {
            $tag = trim($tag);
            if ($tag === '*' || (str_starts_with($tag, 'W/') ? substr($tag, 2) : $tag) === $etag) {
                return true;
            }
        }

        return false;
    }
}
