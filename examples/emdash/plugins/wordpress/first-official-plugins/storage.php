<?php
declare(strict_types=1);
namespace FirstOfficialPlugins;

function register_types(): void {
    foreach (['zpl_event' => 'Plugin events', 'zpl_delivery' => 'Webhook deliveries', 'zpl_form' => 'Forms', 'zpl_submit' => 'Form submissions'] as $type => $label) {
        register_post_type($type, [
            'label' => $label, 'public' => false, 'show_ui' => true,
            'show_in_menu' => 'first-plugin-lab', 'supports' => ['title'],
            'map_meta_cap' => false,
            'capabilities' => array_fill_keys(['edit_post', 'read_post', 'delete_post', 'edit_posts', 'edit_others_posts', 'publish_posts', 'read_private_posts', 'delete_posts', 'delete_private_posts', 'delete_published_posts', 'delete_others_posts', 'edit_private_posts', 'edit_published_posts', 'create_posts', 'read'], 'manage_options'),
        ]);
    }
    add_post_type_support(ENTRY_TYPE, 'comments');
    register_taxonomy('zpl_topic', ENTRY_TYPE, [
        'label' => 'Plugin topics', 'public' => true, 'show_in_rest' => true,
        'capabilities' => ['manage_terms' => 'manage_options', 'edit_terms' => 'manage_options', 'delete_terms' => 'manage_options', 'assign_terms' => 'edit_posts'],
    ]);
}

function store(string $type, string $title, array $data): int {
    $id = wp_insert_post([
        'post_type' => $type, 'post_status' => 'private', 'post_title' => $title,
        'post_content' => wp_slash(wp_json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)),
    ], true);
    if (is_wp_error($id)) { throw new \RuntimeException($id->get_error_message()); }
    return $id;
}

function stored(int $id): array {
    $post = get_post($id);
    return $post ? (json_decode($post->post_content, true) ?? []) : [];
}

function records(string $type, int $limit = 100): array {
    return array_map(static fn ($post): array => ['id' => $post->ID] + stored($post->ID), get_posts([
        'post_type' => $type, 'post_status' => 'private', 'numberposts' => $limit,
        'orderby' => 'ID', 'order' => 'DESC',
    ]));
}

function record(string $event, array $data): int {
    return store('zpl_event', $event, [
        'event' => $event, 'at' => gmdate('c'), 'actor' => get_current_user_id(), 'data' => $data,
    ]);
}

function settings(): array {
    return get_option('first_plugins_settings', []) + [
        'webhookUrl' => '', 'secretToken' => '', 'enabled' => false,
        'events' => ['content.created', 'content.updated', 'content.deleted', 'media.uploaded', 'media.deleted', 'form.submitted'],
        'displayName' => 'The plugin workshop', 'threshold' => 10, 'mode' => 'observe',
    ];
}

function manager(): bool { return current_user_can('manage_options'); }
function editor(): bool { return current_user_can('edit_others_posts'); }
function problem(string $code, string $message, int $status = 422): \WP_Error {
    return new \WP_Error($code, $message, ['status' => $status]);
}
function require_post(int $id, string $type): ?\WP_Post {
    $post = get_post($id);
    return $post && $post->post_type === $type ? $post : null;
}
