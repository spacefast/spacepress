<?php
// Test hooks for live-regions.mjs, served by tests/php/serve_built.php (FIRST_SERVE_MU). Never shipped.
// `POST /__first_test/note` makes the note to comment on; `POST /__first_test/approve` approves a new
// comment on it the way a moderator would, through core; `GET /__first_test/renders` is how many
// page reads the subscription endpoint rendered.
add_action('first_app_live_rendered', static function (): void {
    update_option('test_live_renders', (int) get_option('test_live_renders', 0) + 1, false);
});
add_action('init', static function (): void {
    $path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
    if ($path === '/__first_test/renders') {
        header('Content-Type: application/json');
        echo (int) get_option('test_live_renders', 0);
        exit;
    }
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
