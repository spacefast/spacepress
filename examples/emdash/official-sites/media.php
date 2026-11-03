<?php
/** Apply seed media metadata after one batched native WP-CLI import. */
[$manifest, $site] = $args;
if (realpath(ABSPATH) !== realpath($site)) WP_CLI::error('Media import ownership mismatch.');
$result = [];
foreach (json_decode(file_get_contents($manifest), true, 512, JSON_THROW_ON_ERROR) as $image) {
    if (get_post_type((int)$image['id']) !== 'attachment' || get_post_type((int)$image['post']) !== 'zero_posts') WP_CLI::error('Native media IDs do not match the imported posts.');
    update_post_meta((int)$image['id'], '_wp_attachment_image_alt', $image['alt']);
    update_post_meta((int)$image['post'], 'zero_cover', (int)$image['id']);
    $result[] = ['id' => (int)$image['id'], 'post' => (int)$image['post'], 'source' => $image['source'], 'url' => wp_get_attachment_url((int)$image['id']), 'bytes' => (int)$image['bytes']];
}
echo wp_json_encode($result);
