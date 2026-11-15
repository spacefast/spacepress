<?php

declare(strict_types=1);

/*
 * Media sizes + focal (phase 2 §7.2) on WordPress, in-process (tests/php/wp.php). Media is attachments:
 * the configured sizes are core image sizes `first_<name>`, rendered with the focal crop into files
 * beside the original; a new focal point writes new files inside the transaction and removes the old
 * ones after commit. Core's own regeneration passes are proven in tests/wp/media.test.ts.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$wp = wpSite('media', ['schema' => ['name' => 'sized', 'collections' => [], 'media' => ['sizes' => [
    'thumb' => ['width' => 100, 'height' => 100, 'fit' => 'cover'],
    'wide' => ['width' => 200, 'height' => null, 'fit' => 'inside'],
    'huge' => ['width' => 4000, 'height' => null, 'fit' => 'inside'],
]]]]);
$asEditor = 'editor';
$asAuthor = 'author';
$mediaReq = static function (string $method, string $path, ?string $as, string $body = '', array $files = [], array $query = []) use ($wp): array {
    [$status, $data] = $wp->call($method, $path, $body === '' ? null : $body, $as, $query, $files);

    return [$status, $data];
};
$onDisk = static fn (string $url): string => $wp->uploadPath($url);

$png = static function (int $w, int $h): string {
    $file = tempnam(sys_get_temp_dir(), 'zimg');
    $im = imagecreatetruecolor($w, $h);
    imagefilledrectangle($im, 0, 0, intdiv($w, 2) - 1, $h - 1, imagecolorallocate($im, 255, 0, 0));
    imagefilledrectangle($im, intdiv($w, 2), 0, $w - 1, $h - 1, imagecolorallocate($im, 0, 0, 255));
    imagepng($im, $file);

    return $file;
};
$post = static fn (string $file, string $name) => $mediaReq('POST', '/media', $asAuthor, '', ['file' => ['name' => $name, 'tmp_name' => $file, 'error' => UPLOAD_ERR_OK]]);

[$s, $img] = $post($png(400, 200), 'wide.png');
$base = substr($img['url'], 0, -4);
eq('upload returns every configured size; a size the original fits is the original', [$s, array_map(static fn ($z) => [$z['width'], $z['height']], $img['sizes']), $img['sizes']['huge']['url'], $img['focal']],
    [201, ['thumb' => [100, 100], 'wide' => [200, 100], 'huge' => [400, 200]], $img['url'], null]);
check('size files sit next to the original as <name>-first_<size>-…', str_starts_with($img['sizes']['thumb']['url'], "$base-first_thumb-") && str_starts_with($img['sizes']['wide']['url'], "$base-first_wide-"), $img['sizes']);
eq('… and the attachment metadata names them beside the core sizes', array_values(array_filter(array_keys(wp_get_attachment_metadata($img['id'])['sizes']), static fn ($k) => str_starts_with($k, 'first_'))), ['first_thumb', 'first_wide']);
$dims = static fn (string $url) => array_slice(getimagesize($onDisk($url)) ?: [], 0, 2);
eq('size files exist with their dimensions', [$dims($img['sizes']['thumb']['url']), $dims($img['sizes']['wide']['url'])], [[100, 100], [200, 100]]);
$thumbBytes = file_get_contents($onDisk($img['sizes']['thumb']['url']));
$wideBytes = file_get_contents($onDisk($img['sizes']['wide']['url']));

$focal = json_encode(['focal' => ['x' => 0, 'y' => 0.5], 'alt' => 'Left']);
check('PATCH /media needs editor', $mediaReq('PATCH', "/media/{$img['id']}", $asAuthor, $focal)[0] === 403);
[$s, $patched] = $mediaReq('PATCH', "/media/{$img['id']}", $asEditor, $focal);
eq('PATCH sets focal + alt; inside sizes keep their file', [$s, $patched['focal'], $patched['alt'], $patched['sizes']['wide']], [200, ['x' => 0, 'y' => 0.5], 'Left', $img['sizes']['wide']]);
check('changing focal regenerates the cover size (different bytes) and removes the old crop after commit',
    file_get_contents($onDisk($patched['sizes']['thumb']['url'])) !== $thumbBytes
    && !is_file($onDisk($img['sizes']['thumb']['url']))
    && file_get_contents($onDisk($img['sizes']['wide']['url'])) === $wideBytes);
$t = imagecreatefrompng($onDisk($patched['sizes']['thumb']['url']));
$red = imagecolorsforindex($t, imagecolorat($t, 50, 50));
eq('the regenerated crop follows the focal point (left half is red)', [$red['red'], $red['blue']], [255, 0]);
eq('GET returns the stored focal', $mediaReq('GET', "/media/{$img['id']}", null)[1]['focal'], ['x' => 0, 'y' => 0.5]);
check('focal is validated with a pointer', ($mediaReq('PATCH', "/media/{$img['id']}", $asEditor, '{"focal":{"x":2,"y":0}}')[1]['pointer'] ?? null) === '/focal/x');
check('PATCH unknown media → 404', $mediaReq('PATCH', '/media/999999', $asEditor, '{"alt":"x"}')[0] === 404);

$txt = tempnam(sys_get_temp_dir(), 'ztxt');
file_put_contents($txt, 'plain text');
$doc = $post($txt, 'a.txt')[1];
check('a non-image has sizes: {} on the wire', str_contains($wp->handle('GET', "/media/{$doc['id']}")[2], '"sizes":{}') && $doc['focal'] === null);

// Attachments from before sizes existed get every size the first time their focal point is set.
$legacy = $post($png(300, 300), 'old.png')[1];
$meta = wp_get_attachment_metadata($legacy['id']);
$meta['sizes'] = [];
wp_update_attachment_metadata($legacy['id'], $meta);
$upgraded = $mediaReq('PATCH', "/media/{$legacy['id']}", $asEditor, '{"focal":{"x":0.5,"y":0.5}}')[1];
eq('an attachment uploaded before sizes were configured gets every size on its first focal change', [array_keys($upgraded['sizes']), array_values(array_filter(array_keys(wp_get_attachment_metadata($legacy['id'])['sizes']), static fn ($k) => str_starts_with($k, 'first_')))], [['thumb', 'wide', 'huge'], ['first_thumb', 'first_wide']]);
eq('internal media fields are not queryable at any depth', array_map(
    static fn (string $w) => $mediaReq('GET', '/media', null, query: ['where' => $w])[0],
    ['{"focal":null}', '{"OR":[{"sizes":{"isNull":true}}]}', '{"NOT":{"path":"x"}}'],
), [400, 400, 400]);

// Focal A → B → A inside one transaction: rollback keeps the committed crop, commit the final one.
$sequence = static function (bool $rollback) use ($img, $onDisk, $base): array {
    try {
        \First\db()->transaction(static function () use ($img, $rollback): void {
            \First\db()->media()->update($img['id'], ['focal' => ['x' => 1, 'y' => 0.5]]);
            \First\db()->media()->update($img['id'], ['focal' => ['x' => 0, 'y' => 0.5]]);
            if ($rollback) {
                throw new \RuntimeException('roll back');
            }
        });
    } catch (\RuntimeException) {
    }

    return glob($onDisk("$base-first_thumb-*"));
};
$committed = $mediaReq('GET', "/media/{$img['id']}", null)[1]['sizes']['thumb']['url'];
eq('A → B → A rolled back: only the committed crop remains', $sequence(true), [$onDisk($committed)]);
$files = $sequence(false);
$final = $mediaReq('GET', "/media/{$img['id']}", null)[1]['sizes']['thumb']['url'];
eq('A → B → A committed: exactly the final crop remains, and the row points at it', $files, [$onDisk($final)]);

// A size configured after the upload is filled in on the next focal change.
$meta = wp_get_attachment_metadata($img['id']);
unset($meta['sizes']['first_wide']);
wp_update_attachment_metadata($img['id'], $meta);
$filled = $mediaReq('PATCH', "/media/{$img['id']}", $asEditor, '{"focal":{"x":0.5,"y":0.5}}')[1];
eq('a size missing from the row is rendered on the next focal change', [$filled['sizes']['wide']['width'], $filled['sizes']['wide']['height']], [200, 100]);

// A size the original now fits (config changed) drops its old rendition: file and metadata entry.
$small = $post($png(80, 80), 'small.png')[1];
$stale = substr($onDisk($small['url']), 0, -4) . '-first_thumb-stale.png';
copy($onDisk($small['url']), $stale);
$meta = wp_get_attachment_metadata($small['id']);
$meta['sizes']['first_thumb'] = ['file' => basename($stale), 'width' => 50, 'height' => 50, 'mime-type' => 'image/png'];
wp_update_attachment_metadata($small['id'], $meta);
$refit = $mediaReq('PATCH', "/media/{$small['id']}", $asEditor, '{"focal":{"x":0.5,"y":0.5}}')[1];
eq('a size the original now fits is served by the original and its old file is gone', [$refit['sizes']['thumb']['url'], is_file($stale), isset(wp_get_attachment_metadata($small['id'])['sizes']['first_thumb'])], [$small['url'], false, false]);

$final = $mediaReq('GET', "/media/{$img['id']}", null)[1];
$mediaReq('DELETE', "/media/{$img['id']}", $asEditor);
check('deleting media removes the attachment and its size files after commit', !is_file($onDisk($final['sizes']['thumb']['url'])) && !is_file($onDisk("$base.png")) && get_post($img['id']) === null);

// The rectangles are core's image_resize_dimensions(); First moves a cover crop's origin to the focal
// point. [dst_x, dst_y, src_x, src_y, dst_w, dst_h, src_w, src_h].
$rect = [\First\Media\Images::class, 'dimensions'];
eq('cover: core centres the crop without a focal point; the focal point moves it, clamped to the image', [
    $rect(400, 200, 100, 100, true),
    $rect(400, 200, 100, 100, true, ['x' => 0, 'y' => 0.5]),
    $rect(400, 200, 100, 100, true, ['x' => 1, 'y' => 0.5]),
    $rect(400, 200, 100, 100, true, ['x' => 0.4, 'y' => 0.5]),
    $rect(200, 400, 100, 100, true, ['x' => 0.5, 'y' => 0.9]),
], [
    [0, 0, 100, 0, 100, 100, 200, 200],
    [0, 0, 0, 0, 100, 100, 200, 200],
    [0, 0, 200, 0, 100, 100, 200, 200],
    [0, 0, 60, 0, 100, 100, 200, 200],
    [0, 0, 0, 200, 100, 100, 200, 200],
]);
eq('inside scales to the width; a size core would not make (larger, or within 1px) is null', [
    $rect(400, 200, 100, null, false),
    $rect(80, 60, 100, 100, true),
    $rect(400, 200, 399, null, false),
], [[0, 0, 0, 0, 100, 50, 400, 200], null, null]);
$upscale = static fn ($out, $ow, $oh, $w, $h, $crop) => $crop ? $out : [0, 0, 0, 0, $w, (int) round($w * $oh / $ow), $ow, $oh];
add_filter('image_resize_dimensions', $upscale, 10, 6);
eq("core's image_resize_dimensions filter decides the rectangle (a site that allows upscaling)", $rect(40, 20, 100, null, false), [0, 0, 0, 0, 100, 50, 40, 20]);
remove_filter('image_resize_dimensions', $upscale, 10);
// The optional Jetpack Image CDN adapter builds Photon arguments from the same rectangles.
eq('CDN cover args carry the focal crop rectangle; inside args fit', [
    \First\Wp\Media\ImageCdn::args(400, 200, ['width' => 100, 'height' => 100, 'fit' => 'cover'], ['x' => 1, 'y' => 0]),
    \First\Wp\Media\ImageCdn::args(400, 200, ['width' => 100, 'height' => null, 'fit' => 'inside'], null),
    \First\Wp\Media\ImageCdn::args(40, 20, ['width' => 100, 'height' => null, 'fit' => 'inside'], null),
], [
    [['crop' => '200px,0px,200px,200px', 'resize' => '100,100'], 100, 100],
    [['fit' => '100,50'], 100, 50],
    [[], 40, 20],
]);

finish('media_test');
