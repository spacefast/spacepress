<?php
declare(strict_types=1);
namespace FirstOfficialPlugins;

/** Capture the old state before core mutates it, and the final SCF state at request completion. */
function snapshot(int $id): array {
    $post = get_post($id);
    if (!$post) { return []; }
    $fields = [];
    foreach (get_post_meta($id) as $name => $values) {
        if (str_starts_with($name, 'first_')) { $fields[$name] = maybe_unserialize($values[0]); }
    }
    return ['id' => $id, 'title' => $post->post_title, 'body' => $post->post_content, 'status' => $post->post_status, 'fields' => $fields];
}

function defer_save(int $id, bool $is_new, ?array $before = null): void {
    static $pending = [];
    if (isset($pending[$id])) { return; }
    $pending[$id] = true;
    add_action('shutdown', static function () use ($id, $is_new, $before): void {
        if (!require_post($id, ENTRY_TYPE)) { return; }
        $after = snapshot($id);
        // A rolled-back request leaves no final content; unchanged saves need no new event.
        if ($before === $after) { return; }
        $event = $is_new ? 'content.created' : 'content.updated';
        $data = ['resourceId' => $id, 'before' => $before, 'after' => $after];
        record($event, $data);
        notify($event, $data);
        record('sandbox-example.hook', ['phase' => 'afterSave', 'resourceId' => $id, 'isolation' => 'trusted WordPress PHP']);
        if ($after['status'] === 'publish') {
            update_post_meta($id, '_zpl_standard_document', standard_document($id));
        }
    }, 200);
}

add_action('pre_post_update', static function (int $id): void {
    if (require_post($id, ENTRY_TYPE)) { defer_save($id, false, snapshot($id)); }
}, 1);
add_action('wp_after_insert_post', static function (int $id, \WP_Post $post, bool $update): void {
    if ($post->post_type === ENTRY_TYPE && !wp_is_post_revision($id)) { defer_save($id, !$update); }
}, 200, 3);
add_action('before_delete_post', static function (int $id, \WP_Post $post): void {
    if ($post->post_type !== ENTRY_TYPE && $post->post_type !== 'attachment') { return; }
    $before = snapshot($id);
    add_action('deleted_post', static function (int $deleted) use ($id, $before, $post): void {
        if ($deleted !== $id) { return; }
        $event = $post->post_type === 'attachment' ? 'media.deleted' : 'content.deleted';
        record($event, ['resourceId' => $id, 'before' => $before]);
        notify($event, ['resourceId' => $id, 'before' => $before]);
    });
}, 200, 2);
add_action('add_attachment', static function (int $id): void {
    add_action('shutdown', static function () use ($id): void {
        $data = ['resourceId' => $id, 'url' => wp_get_attachment_url($id), 'mime' => get_post_mime_type($id)];
        record('media.uploaded', $data); notify('media.uploaded', $data);
    }, 200);
});

/** Exact loopback opt-in is a wp-config constant, never a user-supplied bypass. */
function local_webhook(string $url): bool {
    return defined('FIRST_PLUGINS_LOCAL_WEBHOOK') && hash_equals((string) constant('FIRST_PLUGINS_LOCAL_WEBHOOK'), $url)
        && preg_match('#^http://127\.0\.0\.1:[0-9]+/webhook$#D', $url) === 1;
}
function validate_webhook(string $url): bool {
    return local_webhook($url) || (str_starts_with($url, 'https://') && wp_http_validate_url($url) !== false);
}
function notify(string $event, array $data): void {
    $config = settings();
    if (!$config['enabled'] || !$config['webhookUrl'] || !in_array($event, $config['events'], true)) { return; }
    $id = store('zpl_delivery', $event, [
        'event' => $event, 'url' => $config['webhookUrl'], 'payload' => ['event' => $event, 'timestamp' => gmdate('c'), 'data' => $data],
        'attempts' => 0, 'status' => 'pending',
    ]);
    as_enqueue_async_action('first_plugins_deliver', [$id], 'first-official-plugins');
}
function deliver(int $id): void {
    if (!require_post($id, 'zpl_delivery')) { return; }
    $row = stored($id);
    if ($row['status'] === 'success' || $row['attempts'] >= 3) { return; }
    $row['attempts']++;
    if (!validate_webhook($row['url'])) {
        $row['status'] = 'failed'; $row['error'] = 'Destination is not allowed';
    } else {
        $body = wp_json_encode($row['payload']);
        $config = settings();
        $args = ['method' => 'POST', 'timeout' => 10, 'redirection' => 0, 'headers' => [
            'Content-Type' => 'application/json', 'X-EmDash-Event' => $row['event'],
            'Authorization' => 'Bearer ' . $config['secretToken'],
            'X-First-Signature' => hash_hmac('sha256', $body, $config['secretToken']),
        ], 'body' => $body];
        // wp_safe_remote_post forbids loopback. Only this exact dev constant uses the regular transport.
        $response = local_webhook($row['url']) ? wp_remote_post($row['url'], $args) : wp_safe_remote_post($row['url'], $args);
        $row['httpStatus'] = is_wp_error($response) ? 0 : wp_remote_retrieve_response_code($response);
        $row['status'] = $row['httpStatus'] >= 200 && $row['httpStatus'] < 300 ? 'success' : 'failed';
        $row['error'] = is_wp_error($response) ? $response->get_error_message() : null;
    }
    wp_update_post(['ID' => $id, 'post_content' => wp_slash(wp_json_encode($row))]);
    if ($row['status'] === 'failed' && $row['attempts'] < 3) {
        as_schedule_single_action(time() + (2 ** $row['attempts']), 'first_plugins_deliver', [$id], 'first-official-plugins');
    }
}

/** The local fail-closed counterpart: without the real provider, comments remain pending. */
add_filter('pre_comment_approved', static function ($approved, array $comment) {
    if (get_post_type((int) $comment['comment_post_ID']) !== ENTRY_TYPE) { return $approved; }
    return 0;
}, 20, 2);
add_action('wp_insert_comment', static function (int $id): void {
    $comment = get_comment($id);
    if ($comment && get_post_type((int) $comment->comment_post_ID) === ENTRY_TYPE) {
        add_comment_meta($id, 'zpl_moderation', ['provider' => 'unconfigured', 'decision' => $comment->comment_approved === '0' ? 'hold' : 'unchanged', 'reason' => 'Workers AI credentials are required for classification']);
        record('comment.held', ['commentId' => $id]);
    }
});

function standard_document(int $id): array {
    $post = get_post($id);
    return [
        '$type' => 'site.standard.document', 'site' => home_url('/'), 'title' => $post->post_title,
        'path' => '/?first-plugin-entry=' . $id, 'publishedAt' => get_post_time('c', true, $post),
        'textContent' => wp_strip_all_tags($post->post_content),
        'updatedAt' => get_post_modified_time('c', true, $post),
    ];
}

// Core attachment deletion uses a separate admission hook from wp_delete_post().
add_action('delete_attachment', static function (int $id): void {
    $before = snapshot($id);
    add_action('deleted_post', static function (int $deleted) use ($id, $before): void {
        if ($deleted !== $id) { return; }
        $data = ['resourceId' => $id, 'before' => $before];
        record('media.deleted', $data); notify('media.deleted', $data);
    });
}, 200);
