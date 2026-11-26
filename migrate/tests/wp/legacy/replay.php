<?php
// Loads site.json (rows the ORIGINAL Zero kernel wrote, captured by seed.php) into this site with
// their original ids, so references between records hold. Refuses to overwrite an existing row.
declare(strict_types=1);

global $wpdb;
$site = json_decode((string) file_get_contents($args[0] ?? '/tmp/spacepress-legacy-site.json'), true, 512, JSON_THROW_ON_ERROR);
$wpdb->query('START TRANSACTION');
$insert = static function (string $table, array $row) use ($wpdb): void {
    if ($wpdb->insert($table, $row) === false) {
        $wpdb->query('ROLLBACK');
        WP_CLI::error("cannot insert into $table: " . $wpdb->last_error);
    }
};
foreach ($site['terms'] as $t) {
    $insert($wpdb->terms, ['term_id' => $t['term_id'], 'name' => $t['name'], 'slug' => $t['slug'], 'term_group' => $t['term_group']]);
    $insert($wpdb->term_taxonomy, ['term_taxonomy_id' => $t['term_taxonomy_id'], 'term_id' => $t['term_id'], 'taxonomy' => $t['taxonomy'], 'description' => $t['description'], 'parent' => $t['parent'], 'count' => $t['count']]);
}
foreach ($site['termmeta'] as $m) {
    $insert($wpdb->termmeta, $m);
}
foreach ($site['posts'] as $p) {
    $insert($wpdb->posts, $p);
}
foreach ($site['postmeta'] as $m) {
    $insert($wpdb->postmeta, $m);
}
foreach ($site['term_relationships'] as $r) {
    $insert($wpdb->term_relationships, $r);
}
foreach ($site['counts'] as $c) {
    $wpdb->update($wpdb->term_taxonomy, ['count' => $c['count']], ['term_taxonomy_id' => $c['term_taxonomy_id']]);
}
$wpdb->query('COMMIT');
// Upload bytes go back where the original Space kept them: its private root, not wp-content/uploads.
$attached = array_column(array_filter($site['postmeta'], static fn ($m) => $m['meta_key'] === '_wp_attached_file'), 'meta_value', 'post_id');
foreach ($site['files'] as $mid => $bytes) {
    $path = $site['storage'] . '/' . $attached[$mid];
    wp_mkdir_p(dirname($path));
    file_put_contents($path, base64_decode($bytes));
}
wp_cache_flush();
echo wp_json_encode($site['ids']), "\n";
