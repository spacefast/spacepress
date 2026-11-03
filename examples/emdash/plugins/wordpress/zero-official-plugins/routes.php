<?php
declare(strict_types=1);
namespace ZeroOfficialPlugins;

function route(string $path, string $methods, callable $callback, callable $permission): void {
    register_rest_route(NS, $path, ['methods' => $methods, 'callback' => $callback, 'permission_callback' => $permission]);
}
function save_settings(array $input): array|\WP_Error {
    $config = settings();
    if (isset($input['webhookUrl']) && (!is_string($input['webhookUrl']) || ($input['webhookUrl'] !== '' && !validate_webhook($input['webhookUrl'])))) {
        return problem('unsafe_destination', 'Use a public HTTPS webhook URL; loopback requires an exact wp-config development opt-in');
    }
    if (isset($input['threshold']) && (!is_numeric($input['threshold']) || $input['threshold'] < 0 || $input['threshold'] > 100)) { return problem('invalid_threshold', 'Threshold must be between 0 and 100'); }
    if (isset($input['mode']) && !in_array($input['mode'], ['observe', 'exercise'], true)) { return problem('invalid_mode', 'Mode must be observe or exercise'); }
    if (isset($input['enabled']) && !is_bool($input['enabled'])) { return problem('invalid_enabled', 'Enabled must be boolean'); }
    foreach (['webhookUrl', 'secretToken', 'displayName'] as $key) {
        if (isset($input[$key]) && !is_string($input[$key])) { return problem('invalid_setting', "$key must be text"); }
    }
    foreach (['webhookUrl', 'secretToken', 'enabled', 'displayName', 'threshold', 'mode'] as $key) {
        if (array_key_exists($key, $input)) { $config[$key] = $input[$key]; }
    }
    update_option('zero_plugins_settings', $config, false);
    record('settings.saved', ['enabled' => $config['enabled']]);
    unset($config['secretToken']);
    return $config;
}
function register_routes(): void {
    route('/status', 'GET', static fn () => [
        'version' => VERSION, 'storage' => 'WordPress posts, metadata and options',
        'sandbox' => ['available' => false, 'reason' => 'WordPress plugins execute as trusted PHP; no Worker isolation or capability membrane'],
        'providers' => ['ai-moderation' => 'requires Workers AI', 'ai-search' => 'local lexical search only', 'atproto' => 'standard.site export only; no PDS session'],
    ], '__return_true');
    route('/settings', 'GET', static function () {
        $config = settings(); unset($config['secretToken']); return $config;
    }, __NAMESPACE__ . '\\manager');
    route('/settings', 'POST', static fn ($request) => save_settings($request->get_json_params() ?? []), __NAMESPACE__ . '\\manager');
    route('/events', 'GET', static fn () => records('zpl_event'), __NAMESPACE__ . '\\manager');
    route('/deliveries', 'GET', static fn () => records('zpl_delivery'), __NAMESPACE__ . '\\manager');
    route('/forms', 'GET', static fn () => records('zpl_form'), __NAMESPACE__ . '\\manager');
    route('/forms', 'POST', static function ($request) {
        $form = valid_form($request->get_json_params() ?? []);
        return is_wp_error($form) ? $form : ['id' => store('zpl_form', $form['name'], $form)] + $form;
    }, __NAMESPACE__ . '\\manager');
    route('/forms/(?P<id>\d+)', 'PATCH', static function ($request) {
        $id = (int) $request['id'];
        if (!require_post($id, 'zpl_form')) { return problem('not_found', 'Form not found', 404); }
        $form = valid_form(array_replace(stored($id), $request->get_json_params() ?? []));
        if (is_wp_error($form)) { return $form; }
        wp_update_post(['ID' => $id, 'post_content' => wp_slash(wp_json_encode($form))]);
        return ['id' => $id] + $form;
    }, __NAMESPACE__ . '\\manager');
    route('/forms/(?P<id>\d+)/definition', 'GET', static fn ($request) => public_definition((int) $request['id']), '__return_true');
    route('/forms/(?P<id>\d+)/submit', 'POST', __NAMESPACE__ . '\\submit', '__return_true');
    route('/submissions', 'GET', static fn () => records('zpl_submit'), __NAMESPACE__ . '\\manager');
    route('/submissions/(?P<id>\d+)', 'PATCH', static function ($request) {
        $id = (int) $request['id'];
        if (!require_post($id, 'zpl_submit')) { return problem('not_found', 'Submission not found', 404); }
        $row = stored($id); $input = $request->get_json_params() ?? [];
        if (isset($input['status']) && !in_array($input['status'], ['new', 'read', 'archived'], true)) { return problem('invalid_status', 'Invalid status'); }
        if (isset($input['starred']) && !is_bool($input['starred'])) { return problem('invalid_starred', 'Starred must be boolean'); }
        foreach (['status', 'starred', 'notes'] as $key) { if (isset($input[$key])) { $row[$key] = $input[$key]; } }
        wp_update_post(['ID' => $id, 'post_content' => wp_slash(wp_json_encode($row))]); return ['id' => $id] + $row;
    }, __NAMESPACE__ . '\\manager');
    route('/api/kv/(?P<key>[a-zA-Z0-9_-]{1,80})', 'GET,POST,DELETE', static function ($request) {
        $key = 'zero_plugins_kv_' . $request['key'];
        if ($request->get_method() === 'POST') {
            $input = $request->get_json_params() ?? [];
            if (!array_key_exists('value', $input)) { return problem('missing_value', 'value is required'); }
            update_option($key, $input['value'], false);
        } elseif ($request->get_method() === 'DELETE') { delete_option($key); }
        return ['key' => $request['key'], 'value' => get_option($key, null)];
    }, __NAMESPACE__ . '\\manager');
    route('/api/diagnostics', 'POST', static function () {
        $term = wp_insert_term('Plugin diagnostics ' . wp_generate_uuid4(), 'zpl_topic');
        if (is_wp_error($term)) { return $term; }
        record('diagnostics.taxonomy', ['termId' => $term['term_id']]);
        as_enqueue_async_action('zero_plugins_diagnostic', [$term['term_id']], 'zero-official-plugins');
        return ['termId' => $term['term_id'], 'queued' => true, 'phpIsolation' => false];
    }, __NAMESPACE__ . '\\manager');
    route('/search', 'GET', static function ($request) {
        $query = new \WP_Query(['post_type' => ENTRY_TYPE, 'post_status' => 'publish', 'has_password' => false, 's' => sanitize_text_field((string) $request->get_param('q')), 'posts_per_page' => 20]);
        return ['provider' => 'wordpress-lexical', 'semantic' => false, 'results' => array_map(static fn ($post) => ['id' => $post->ID, 'title' => $post->post_title, 'url' => home_url('/?zero-plugin-entry=' . $post->ID)], $query->posts)];
    }, '__return_true');
    route('/atproto/publication', 'GET', static fn () => ['$type' => 'site.standard.publication', 'url' => home_url(), 'name' => settings()['displayName']], '__return_true');
    route('/atproto/documents/(?P<id>\d+)', 'GET', static function ($request) {
        $id = (int) $request['id']; $post = require_post($id, ENTRY_TYPE);
        return $post && $post->post_status === 'publish' && $post->post_password === '' ? standard_document($id) : problem('not_found', 'Published story not found', 404);
    }, '__return_true');
    foreach (['ai-moderation/analyze', 'ai-search/semantic', 'atproto/sync'] as $path) {
        route('/' . $path, 'POST', static fn () => problem('external_provider_required', 'This operation requires the real upstream external service; local mode has no provider credentials or binding', 424), __NAMESPACE__ . '\\manager');
    }
    route('/sandbox/probe', 'POST', static fn () => problem('isolation_unavailable', 'Trusted WordPress PHP cannot prove Worker isolation, per-plugin KV separation, or capability denial', 501), __NAMESPACE__ . '\\manager');
}
add_action('zero_plugins_diagnostic', static function (int $term): void {
    record('diagnostics.cron', ['termId' => $term, 'exists' => term_exists($term, 'zpl_topic') !== null]);
});
