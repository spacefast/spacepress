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
     * or null when core would make no file (larger than the original, or within 1px of it): the
     * size is then the original. A port of image_resize_dimensions() + wp_constrain_dimensions(),
     * with the crop origin at the focal point when one is given.
     *
     * @param ?array{x: float|int, y: float|int} $focal 0..1 from the top-left; null = centre
     * @return ?list<int>
     */
    public static function dimensions(int $origW, int $origH, int $w, ?int $h, bool $crop, ?array $focal = null): ?array
    {
        $h ??= 0;
        if ($origW <= 0 || $origH <= 0 || ($w <= 0 && $h <= 0)) {
            return null;
        }
        $smaller = match (true) {
            $h === 0 => $origW < $w,
            $w === 0 => $origH < $h,
            default => $origW < $w && $origH < $h,
        };
        if ($smaller) {
            return null;
        }
        if ($crop) {
            $newW = min($w, $origW);
            $newH = min($h, $origH);
            $newW = $newW ?: (int) round($newH * $origW / $origH);
            $newH = $newH ?: (int) round($newW / ($origW / $origH));
            $ratio = max($newW / $origW, $newH / $origH);
            $cropW = (int) round($newW / $ratio);
            $cropH = (int) round($newH / $ratio);
            $x = $focal === null ? (int) floor(($origW - $cropW) / 2) : self::origin((float) $focal['x'], $origW, $cropW);
            $y = $focal === null ? (int) floor(($origH - $cropH) / 2) : self::origin((float) $focal['y'], $origH, $cropH);
        } else {
            [$newW, $newH] = self::constrain($origW, $origH, $w, $h);
            [$x, $y, $cropW, $cropH] = [0, 0, $origW, $origH];
        }
        if (abs($newW - $origW) <= 1 && abs($newH - $origH) <= 1) {
            return null;
        }

        return [0, 0, $x, $y, $newW, $newH, $cropW, $cropH];
    }

    /** wp_constrain_dimensions(): fit inside max width/height (0 = unbounded), snapping 1px rounding shortfalls. */
    private static function constrain(int $curW, int $curH, int $maxW, int $maxH): array
    {
        [$wr, $hr, $didW, $didH] = [1.0, 1.0, false, false];
        if ($maxW > 0 && $curW > $maxW) {
            [$wr, $didW] = [$maxW / $curW, true];
        }
        if ($maxH > 0 && $curH > $maxH) {
            [$hr, $didH] = [$maxH / $curH, true];
        }
        $larger = max($wr, $hr);
        $ratio = (int) round($curW * $larger) > $maxW || (int) round($curH * $larger) > $maxH ? min($wr, $hr) : $larger;
        $w = max(1, (int) round($curW * $ratio));
        $h = max(1, (int) round($curH * $ratio));

        return [$didW && $w === $maxW - 1 ? $maxW : $w, $didH && $h === $maxH - 1 ? $maxH : $h];
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

    /** More than one image descriptor, walking the GIF block structure. */
    private static function animated(string $path): bool
    {
        $b = (string) @file_get_contents($path);
        $n = strlen($b);
        if ($n < 13 || !str_starts_with($b, 'GIF')) {
            return false;
        }
        $flags = ord($b[10]);
        $i = 13 + (($flags & 0x80) ? 3 << (($flags & 7) + 1) : 0);
        $frames = 0;
        $skip = static function (int $i) use ($b, $n): int {
            while ($i < $n && ($len = ord($b[$i])) !== 0) {
                $i += $len + 1;
            }

            return $i + 1;
        };
        while ($i < $n) {
            $block = ord($b[$i]);
            if ($block === 0x2C) {
                if (++$frames > 1) {
                    return true;
                }
                $local = $i + 9 < $n ? ord($b[$i + 9]) : 0;
                $i += 10 + (($local & 0x80) ? 3 << (($local & 7) + 1) : 0);
                $i = $skip($i + 1);
            } elseif ($block === 0x21) {
                $i = $skip($i + 2);
            } else {
                break;
            }
        }

        return false;
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
            'image/gif' => self::gif($out, $dest),
            'image/webp' => imagewebp($out, $dest, 82),
        };
        if (!$ok) {
            throw new \RuntimeException('Cannot write the resized image');
        }
    }

    /** GIF has one transparent palette index, not an alpha channel: map transparent pixels onto it. */
    private static function gif(\GdImage $img, string $dest): bool
    {
        $w = imagesx($img);
        $h = imagesy($img);
        $mask = [];
        for ($y = 0; $y < $h; $y++) {
            for ($x = 0; $x < $w; $x++) {
                if (((imagecolorat($img, $x, $y) >> 24) & 0x7F) >= 64) {
                    $mask[] = [$x, $y];
                }
            }
        }
        imagetruecolortopalette($img, false, 255);
        if ($mask !== []) {
            $key = imagecolorallocate($img, 255, 0, 255);
            imagecolortransparent($img, $key);
            foreach ($mask as [$x, $y]) {
                imagesetpixel($img, $x, $y, $key);
            }
        }

        return imagegif($img, $dest);
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
