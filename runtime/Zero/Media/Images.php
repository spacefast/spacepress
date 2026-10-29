<?php

declare(strict_types=1);

namespace Zero\Media;

use Zero\HttpError;

/**
 * Named image sizes (phase 2 §7.2): the rectangle math both targets share and the GD renderer the
 * standalone target uses. dimensions() matches core's image_resize_dimensions() (same rounding, no
 * upscaling), with the crop origin moved to the focal point when one is set.
 */
final class Images
{
    /** Formats GD and WordPress both resize. SVG, AVIF and animated GIFs get no sizes. */
    public const RESIZABLE = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

    /**
     * The resize rectangle in core's shape: [dst_x, dst_y, src_x, src_y, dst_w, dst_h, src_w, src_h],
     * or null when the original is already within the size (no file is made; the size is the original).
     *
     * @param ?array{x: float|int, y: float|int} $focal 0..1 from the top-left; null = centre
     * @return ?list<int>
     */
    public static function dimensions(int $origW, int $origH, int $w, ?int $h, bool $crop, ?array $focal = null): ?array
    {
        if ($origW <= 0 || $origH <= 0 || $w <= 0) {
            return null;
        }
        if ($crop) {
            $h ??= $origH;
            $newW = min($w, $origW);
            $newH = min($h, $origH);
            $ratio = max($newW / $origW, $newH / $origH);
            $cropW = (int) round($newW / $ratio);
            $cropH = (int) round($newH / $ratio);
            $x = $focal === null ? (int) floor(($origW - $cropW) / 2) : self::origin((float) $focal['x'], $origW, $cropW);
            $y = $focal === null ? (int) floor(($origH - $cropH) / 2) : self::origin((float) $focal['y'], $origH, $cropH);
        } else {
            $ratio = min(1.0, $w / $origW, $h === null ? 1.0 : $h / $origH);
            $newW = max(1, (int) round($origW * $ratio));
            $newH = max(1, (int) round($origH * $ratio));
            [$x, $y, $cropW, $cropH] = [0, 0, $origW, $origH];
        }
        if ($newW === $origW && $newH === $origH) {
            return null;
        }

        return [0, 0, $x, $y, $newW, $newH, $cropW, $cropH];
    }

    /** x0 = clamp(focal * W - w/2, 0, W - w). */
    private static function origin(float $focal, int $full, int $crop): int
    {
        return (int) max(0, min($full - $crop, round($focal * $full - $crop / 2)));
    }

    /** True when $path is a still image in a format both targets resize. */
    public static function resizable(string $path, string $mime): bool
    {
        return in_array($mime, self::RESIZABLE, true) && !($mime === 'image/gif' && self::animated($path));
    }

    /** More than one frame: a graphic control extension followed by an image descriptor, twice. */
    private static function animated(string $path): bool
    {
        $bytes = (string) @file_get_contents($path);

        return preg_match_all('#\x00\x21\xF9\x04.{4}\x00[\x2C\x21]#s', $bytes) > 1;
    }

    /** Render one size with GD into $dest, in the source's format. */
    public static function render(string $src, string $mime, array $dims, string $dest): void
    {
        $image = @imagecreatefromstring((string) file_get_contents($src));
        if ($image === false) {
            throw new \RuntimeException('Cannot decode the image');
        }
        [, , $sx, $sy, $dw, $dh, $sw, $sh] = $dims;
        $out = imagecreatetruecolor($dw, $dh);
        if ($mime !== 'image/jpeg') {
            imagealphablending($out, false);
            imagesavealpha($out, true);
            imagefill($out, 0, 0, imagecolorallocatealpha($out, 0, 0, 0, 127));
        }
        imagecopyresampled($out, $image, 0, 0, $sx, $sy, $dw, $dh, $sw, $sh);
        $ok = match ($mime) {
            'image/jpeg' => imagejpeg($out, $dest, 82),
            'image/png' => imagepng($out, $dest),
            'image/gif' => imagegif($out, $dest),
            'image/webp' => imagewebp($out, $dest, 82),
        };
        if (!$ok) {
            throw new \RuntimeException('Cannot write the resized image');
        }
    }

    /** Validate a focal point from request input: {x, y} in 0..1, or null. */
    public static function focal(mixed $v): ?array
    {
        if ($v === null) {
            return null;
        }
        if (!is_array($v) || array_is_list($v) && $v !== []) {
            throw HttpError::invalidInput('focal must be an object { x, y } or null', '/focal');
        }
        foreach ($v as $key => $_) {
            if ($key !== 'x' && $key !== 'y') {
                throw HttpError::invalidInput("Unknown field '$key'", '/focal/' . $key);
            }
        }
        $out = [];
        foreach (['x', 'y'] as $axis) {
            $n = $v[$axis] ?? null;
            if (!(is_int($n) || is_float($n)) || !is_finite((float) $n) || $n < 0 || $n > 1) {
                throw HttpError::invalidInput("focal.$axis must be a number from 0 to 1", "/focal/$axis");
            }
            $out[$axis] = is_int($n) ? $n : (float) $n;
        }

        return $out;
    }
}
