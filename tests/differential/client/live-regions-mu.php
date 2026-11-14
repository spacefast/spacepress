<?php
// Test hooks for live-regions.mjs, served by tests/php/serve_built.php (FIRST_SERVE_MU). Never shipped.
// `POST /__first_test/note` makes the note to comment on; `POST /__first_test/approve` approves a new
// comment on it the way a moderator would, through core.
add_action('init', static function (): void {
    $path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || !in_array($path, ['/__first_test/note', '/__first_test/approve'], true)) {
        return;
    }
    wp_set_current_user(1);
    if ($path === '/__first_test/note') {
        \First\Wp\Runtime::plugin()->app();
        \First\db()->insert('notes', ['title' => 'One', 'slug' => 'one', 'status' => 'published']);
    } else {
        $post = get_page_by_path('one', OBJECT, 'first_notes');
        $id = (int) wp_insert_comment(['comment_post_ID' => $post->ID, 'comment_content' => 'Approved live', 'comment_author' => 'admin', 'user_id' => 1, 'comment_approved' => 0]);
        wp_set_comment_status($id, 'approve');
    }
    status_header(204);
    exit;
}, 99);
