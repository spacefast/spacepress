<?php

declare(strict_types=1);

/* Image sizes (phase 2 §7.2) without WordPress: focal validation and which files resize. The resize
 * rectangles come from core and are proven in media_test.php. */

use Zero\Media\Images;

require dirname(__DIR__, 2) . '/runtime/Zero/bootstrap.php';
require __DIR__ . '/harness.php';

$problem = static function (string $label, mixed $v, string $pointer): void {
    problem($label, static fn () => Images::focal($v), 422, 'invalid_input', $pointer);
};
eq('focal accepts 0..1 and null', [Images::focal(['x' => 0, 'y' => 0.25]), Images::focal(null)], [['x' => 0, 'y' => 0.25], null]);
$problem('focal out of range', ['x' => 1.5, 'y' => 0], '/focal/x');
$problem('focal missing axis', ['x' => 0.5], '/focal/y');
$problem('focal unknown key', ['x' => 0.5, 'y' => 0.5, 'z' => 1], '/focal/z');
$problem('focal not an object', [0.5, 0.5], '/focal');

$dir = sys_get_temp_dir() . '/zero-images-' . bin2hex(random_bytes(4));
mkdir($dir);
register_shutdown_function(static fn () => exec('rm -rf ' . escapeshellarg($dir)));
// Left half red, right half blue: a crop's colour shows where its origin landed.
$im = imagecreatetruecolor(400, 200);
imagefilledrectangle($im, 0, 0, 199, 199, imagecolorallocate($im, 255, 0, 0));
imagefilledrectangle($im, 200, 0, 399, 199, imagecolorallocate($im, 0, 0, 255));
imagepng($im, "$dir/src.png");

// Real GIFs from GD: a still image; two frames (white palette entry last, no control extension on
// the second frame) is an animation; SVG never resizes.
$gif = static function (int $frames, bool $control) use ($dir): string {
    $img = imagecreate(2, 2);
    imagecolorallocate($img, 0, 0, 0);
    imagecolorallocate($img, 255, 255, 255);
    ob_start();
    imagegif($img);
    $one = (string) ob_get_clean();
    // Header + logical screen + global table, then the image block(s), then the trailer.
    $table = 3 << ((ord($one[10]) & 7) + 1);
    $head = substr($one, 0, 13 + $table);
    $body = substr($one, 13 + $table, -1);
    $gce = "\x21\xF9\x04\x00\x0A\x00\x00\x00";
    $file = "$dir/" . $frames . ($control ? 'c' : '') . '.gif';
    file_put_contents($file, $head . ($control ? $gce : '') . $body . str_repeat($body, $frames - 1) . "\x3B");

    return $file;
};
check('the GIF fixtures decode', imagecreatefromgif($gif(2, false)) !== false && imagecreatefromgif($gif(2, true)) !== false);
eq('still GIF resizes; animated GIFs (with or without control blocks) and SVG do not', [
    Images::resizable($gif(1, false), 'image/gif'), Images::resizable($gif(2, false), 'image/gif'), Images::resizable($gif(2, true), 'image/gif'),
    Images::resizable("$dir/src.png", 'image/svg+xml'),
], [true, false, false, false]);

finish('images_test');
