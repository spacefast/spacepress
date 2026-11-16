<?php

declare(strict_types=1);

namespace First;

/**
 * HTTP validators for what First serves as is (prebuilt pages, the OpenAPI document): a strong
 * ETag, and whether `If-None-Match` names it. Matching follows `Wp\PublicFiles::matches()` (`*`, a
 * comma-separated list, weak `W/"…"` forms); it is a copy until the public-file serving work lands,
 * then one of the two should call the other.
 */
final class Validator
{
    /** A file's ETag, as public files spell it: size and modification time. */
    public static function file(string $path): string
    {
        clearstatcache(true, $path);

        return '"' . dechex((int) @filesize($path)) . '-' . dechex((int) @filemtime($path)) . '"';
    }

    /** Whether the request's `If-None-Match` names $etag. */
    public static function matches(string $etag): bool
    {
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
