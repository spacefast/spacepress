<?php

// Destructive fixture setup for this disposable harness only. Never part of a plugin.
if (!defined('WP_CLI') || !WP_CLI || getenv('TP_PROTECTED_BENCH') !== '1') {
    throw new RuntimeException('requires TP_PROTECTED_BENCH=1 in the disposable CLI');
}
$count = (int) ($args[0] ?? 10000);
if ($count < 0 || $count > 100000) { throw new RuntimeException('invalid fixture size'); }
global $wpdb;
foreach ($wpdb->get_col("SELECT ID FROM {$wpdb->posts} WHERE post_type = 'tp_posts'") as $id) {
    wp_delete_post((int) $id, true);
}
// Bulk insertion keeps setup independent of the very policy and caches under measurement.
for ($start = 0; $start < $count; $start += 500) {
    $values = [];
    for ($i = $start; $i < min($count, $start + 500); $i++) {
        $values[] = $wpdb->prepare("(%s, %s, %s, %s, %s, %s, %s, %s)",
            'tp_posts', 'publish', "Protected $i", 'shared-benchmark-password', '', '', '', '');
    }
    if ($wpdb->query("INSERT INTO {$wpdb->posts} (post_type, post_status, post_title, post_password, post_content, post_excerpt, to_ping, pinged) VALUES " . implode(',', $values)) === false) {
        throw new RuntimeException($wpdb->last_error);
    }
}
$db = \TypedPress\Wp\Runtime::plugin()->app()->db;
for ($i = 0; $i < 25; $i++) {
    $db->insert('posts', ['title' => "Benchmark $i", 'status' => 'published'], true);
}
wp_cache_flush();
echo json_encode(['protected' => $count, 'public' => 25], JSON_THROW_ON_ERROR);
