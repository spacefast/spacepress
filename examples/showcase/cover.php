<?php

// Original demo artwork, written as PNG to stdout. Requires the usual GD extension.
declare(strict_types=1);

$image = imagecreatetruecolor(1200, 750);
for ($y = 0; $y < 750; $y++) {
    $color = imagecolorallocate($image, 190 - intdiv($y, 15), 205 - intdiv($y, 20), 174 - intdiv($y, 30));
    imagefilledrectangle($image, 0, $y, 1200, $y, $color);
}
imagefilledellipse($image, 920, 190, 250, 250, imagecolorallocate($image, 242, 230, 186));
imagefilledpolygon($image, [0, 750, 0, 550, 320, 220, 760, 750], imagecolorallocate($image, 64, 99, 77));
imagefilledpolygon($image, [420, 750, 870, 310, 1200, 560, 1200, 750], imagecolorallocate($image, 39, 75, 57));
imagepng($image);
