<?php

declare(strict_types=1);

/* Image sizes (phase 2 §7.2): core-compatible resize rectangles, focal-aware crops, GD rendering. */

use Zero\Media\Images;

require dirname(__DIR__, 2) . '/runtime/Zero/bootstrap.php';
require __DIR__ . '/harness.php';

// [dst_x, dst_y, src_x, src_y, dst_w, dst_h, src_w, src_h], as core's image_resize_dimensions().
eq('cover centres the crop without a focal point', Images::dimensions(400, 200, 100, 100, true), [0, 0, 100, 0, 100, 100, 200, 200]);
eq('cover: focal x=0 pins the crop to the left edge', Images::dimensions(400, 200, 100, 100, true, ['x' => 0, 'y' => 0.5]), [0, 0, 0, 0, 100, 100, 200, 200]);
eq('cover: focal x=1 pins the crop to the right edge', Images::dimensions(400, 200, 100, 100, true, ['x' => 1, 'y' => 0.5]), [0, 0, 200, 0, 100, 100, 200, 200]);
eq('cover: x0 = focal.x * W - w/2', Images::dimensions(400, 200, 100, 100, true, ['x' => 0.4, 'y' => 0.5]), [0, 0, 60, 0, 100, 100, 200, 200]);
eq('cover: vertical focal on a tall image', Images::dimensions(200, 400, 100, 100, true, ['x' => 0.5, 'y' => 0.9]), [0, 0, 0, 200, 100, 100, 200, 200]);
eq('cover larger than the original → no file (core never upscales)', Images::dimensions(80, 60, 100, 100, true), null);
eq('cover wider than the original clamps each axis, as core does', Images::dimensions(80, 200, 100, 100, true), [0, 0, 0, 50, 80, 100, 80, 100]);
eq('inside scales to the width, height derived', Images::dimensions(400, 200, 100, null, false), [0, 0, 0, 0, 100, 50, 400, 200]);
eq('inside within both bounds', Images::dimensions(400, 200, 300, 50, false), [0, 0, 0, 0, 100, 50, 400, 200]);
eq('inside never upscales', Images::dimensions(40, 20, 100, null, false), null);

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
$colour = static function (string $file): array {
    $img = imagecreatefrompng($file);
    $c = imagecolorsforindex($img, imagecolorat($img, intdiv(imagesx($img), 2), intdiv(imagesy($img), 2)));

    return [imagesx($img), imagesy($img), $c['red'], $c['blue']];
};
Images::render("$dir/src.png", 'image/png', Images::dimensions(400, 200, 100, 100, true, ['x' => 0, 'y' => 0]), "$dir/left.png");
Images::render("$dir/src.png", 'image/png', Images::dimensions(400, 200, 100, 100, true, ['x' => 1, 'y' => 0]), "$dir/right.png");
eq('GD renders the focal crop: left focal is red', $colour("$dir/left.png"), [100, 100, 255, 0]);
eq('GD renders the focal crop: right focal is blue', $colour("$dir/right.png"), [100, 100, 0, 255]);

// One frame is a still image; two frames are an animation (no sizes).
$frame = "\x21\xF9\x04\x00\x0A\x00\x00\x00\x2C\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02\x44\x01\x00";
file_put_contents("$dir/still.gif", "GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xFF\xFF\xFF\x00" . $frame . "\x3B");
file_put_contents("$dir/anim.gif", "GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xFF\xFF\xFF\x00" . $frame . $frame . "\x3B");
eq('still GIF resizes, animated GIF and SVG do not', [
    Images::resizable("$dir/still.gif", 'image/gif'), Images::resizable("$dir/anim.gif", 'image/gif'), Images::resizable("$dir/src.png", 'image/svg+xml'),
], [true, false, false]);

// The optional Jetpack Image CDN adapter (WP only) builds Photon arguments from the same rectangles.
require dirname(__DIR__, 2) . '/runtime/Zero/Wp/Media/ImageCdn.php';
eq('CDN cover args carry the focal crop rectangle; inside args fit', [
    \Zero\Wp\Media\ImageCdn::args(400, 200, ['width' => 100, 'height' => 100, 'fit' => 'cover'], ['x' => 1, 'y' => 0]),
    \Zero\Wp\Media\ImageCdn::args(400, 200, ['width' => 100, 'height' => null, 'fit' => 'inside'], null),
    \Zero\Wp\Media\ImageCdn::args(40, 20, ['width' => 100, 'height' => null, 'fit' => 'inside'], null),
], [
    [['crop' => '200px,0px,200px,200px', 'resize' => '100,100'], 100, 100],
    [['fit' => '100,50'], 100, 50],
    [[], 40, 20],
]);

finish('images_test');
