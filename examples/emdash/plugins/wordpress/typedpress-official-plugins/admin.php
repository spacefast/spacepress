<?php
declare(strict_types=1);
namespace TypedPressOfficialPlugins;

function field_controls(): void {
    // Extend the generated native field rather than replacing the editor.
    add_filter('acf/load_field/name=tp_palette', static function (array $field): array {
        $field['type'] = 'color_picker'; return $field;
    });
}
function admin_menu(): void {
    add_menu_page('Plugin workshop', 'Plugin workshop', 'manage_options', 'typedpress-plugin-lab', __NAMESPACE__ . '\\admin_page', 'dashicons-admin-plugins');
}
function admin_page(): void {
    if (!manager()) { return; }
    $notice = '';
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['form_definition'])) {
        check_admin_referer('tp_plugin_form');
        $decoded = json_decode(wp_unslash($_POST['form_definition']), true);
        $result = is_array($decoded) ? valid_form($decoded) : problem('invalid_form', 'Enter a valid JSON form definition');
        if (is_wp_error($result)) { $notice = $result->get_error_message(); }
        else {
            $id = absint($_POST['form_id'] ?? 0);
            if ($id && !require_post($id, 'zpl_form')) { $notice = 'Form not found.'; }
            else {
                if ($id) { wp_update_post(['ID' => $id, 'post_content' => wp_slash(wp_json_encode($result))]); }
                else { $id = store('zpl_form', $result['name'], $result); }
                $notice = 'Form ' . $id . ' saved.';
            }
        }
    } elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
        check_admin_referer('tp_plugin_settings');
        $input = [
            'displayName' => sanitize_text_field(wp_unslash($_POST['displayName'] ?? '')),
            'webhookUrl' => trim(wp_unslash($_POST['webhookUrl'] ?? '')),
            'enabled' => isset($_POST['enabled']),
        ];
        if (!empty($_POST['secretToken'])) { $input['secretToken'] = wp_unslash($_POST['secretToken']); }
        $result = save_settings($input);
        $notice = is_wp_error($result) ? $result->get_error_message() : 'Settings saved.';
    }
    $config = settings();
    echo '<div class="wrap"><h1>Plugin workshop</h1><p>Native WordPress plugins, real content and persisted events. <a href="' . esc_url(home_url('/?typedpress-plugins=1')) . '">Open the publication</a>.</p>';
    if ($notice) { echo '<div class="notice notice-info"><p>' . esc_html($notice) . '</p></div>'; }
    echo '<form method="post">'; wp_nonce_field('tp_plugin_settings');
    foreach (['displayName' => 'Publication name', 'webhookUrl' => 'Webhook URL', 'secretToken' => 'Webhook token (leave blank to keep)'] as $name => $label) {
        echo '<p><label>' . esc_html($label) . '<br><input class="regular-text" type="' . ($name === 'secretToken' ? 'password' : 'text') . '" name="' . esc_attr($name) . '" value="' . ($name === 'secretToken' ? '' : esc_attr($config[$name])) . '"></label></p>';
    }
    echo '<p><label><input type="checkbox" name="enabled" ' . checked($config['enabled'], true, false) . '> Send content, media and form events</label></p>';
    submit_button('Save settings'); echo '</form>';
    form_editor();
    echo '<h2>Recent audit history</h2><table class="widefat striped"><thead><tr><th>Event</th><th>Time</th><th>Actor</th><th>Details</th></tr></thead><tbody>';
    foreach (records('zpl_event', 20) as $event) {
        echo '<tr><td>' . esc_html($event['event']) . '</td><td>' . esc_html($event['at']) . '</td><td>' . (int) $event['actor'] . '</td><td><details><summary>View</summary><pre>' . esc_html(wp_json_encode($event['data'], JSON_PRETTY_PRINT)) . '</pre></details></td></tr>';
    }
    echo '</tbody></table><h2>Dependencies</h2><p>AI classification and semantic search need Cloudflare. AT Protocol export is local; publishing needs a PDS session. WordPress plugins run as trusted PHP. Open the REST status endpoint for precise capabilities.</p></div>';
}
function public_page(): void {
    if (!isset($_GET['typedpress-plugins']) && !isset($_GET['typedpress-plugin-entry'])) { return; }
    status_header(200); nocache_headers(); header('Content-Type: text/html; charset=utf-8');
    $entry_id = absint($_GET['typedpress-plugin-entry'] ?? 0);
    $entries = $entry_id ? [get_post($entry_id)] : get_posts(['post_type' => ENTRY_TYPE, 'post_status' => 'publish', 'has_password' => false, 'numberposts' => 20]);
    $entries = array_filter($entries, static fn ($post) => $post && $post->post_type === ENTRY_TYPE && $post->post_status === 'publish');
    if ($entry_id && !$entries) { status_header(404); }
    $assets = plugin_dir_url(__FILE__);
    ?><!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title><?php echo esc_html(settings()['displayName']); ?></title><link rel="stylesheet" href="<?php echo esc_url($assets . 'workshop.css'); ?>"></head><body>
    <nav><a class="brand" href="<?php echo esc_url(home_url('/?typedpress-plugins=1')); ?>">FIRST / PLUGIN WORKSHOP</a><div><a href="<?php echo esc_url(admin_url('edit.php?post_type=' . ENTRY_TYPE)); ?>">Write a story</a><a href="<?php echo esc_url(admin_url('admin.php?page=typedpress-plugin-lab')); ?>">Workshop</a><a href="<?php echo esc_url(admin_url('plugins.php')); ?>">Plugins</a><a href="<?php echo esc_url(admin_url('options-general.php')); ?>">Settings</a></div></nav>
    <header><p class="eyebrow">THE SMALL TOOLS THAT MAKE A PUBLICATION</p><h1><?php echo esc_html(settings()['displayName']); ?></h1><p>Stories, structured fields and a working inbox. Built on WordPress, extended with TypedPress.</p><form id="search"><label>Find a story <input name="q" type="search" placeholder="Search the publication"></label><button>Search</button></form><div id="search-results" aria-live="polite"></div></header>
    <main><section class="stories"><h2>From the workshop</h2><?php if (!$entries) { echo '<p>No published stories yet. Create one in the native editor.</p>'; } ?>
    <?php foreach ($entries as $post) : $locked = post_password_required($post); $palette = $locked ? '' : get_post_meta($post->ID, 'tp_palette', true); $palette = preg_match('/^#[0-9a-f]{6}$/iD', (string) $palette) ? $palette : '#375c48'; ?>
    <article style="--accent:<?php echo esc_attr($palette); ?>"><p class="eyebrow">FIELD NOTES / <?php echo (int) $post->ID; ?></p><h2><a href="<?php echo esc_url(home_url('/?typedpress-plugin-entry=' . $post->ID)); ?>"><?php echo esc_html($post->post_title); ?></a></h2><?php if ($locked): echo get_the_password_form($post); ?></article><?php continue; endif; ?><div class="prose"><?php echo wp_kses_post(do_blocks($post->post_content)); ?></div>
    <?php $profile = get_field('tp_profile', $post->ID); $ingredients = get_field('tp_ingredients', $post->ID); $grid = get_field('tp_grid', $post->ID); $tags = get_field('tp_tags', $post->ID); ?>
    <?php foreach (['Profile' => $profile, 'Ingredients' => $ingredients, 'Grid' => $grid, 'Tags' => $tags] as $label => $value) : if ($value) : ?><details><summary><?php echo esc_html($label); ?></summary><pre><?php echo esc_html(is_string($value) ? $value : wp_json_encode($value, JSON_PRETTY_PRINT)); ?></pre></details><?php endif; endforeach; ?>
    <?php $embeds = get_post_meta($post->ID, 'tp_embeds', true); if (is_string($embeds)) { $embeds = json_decode($embeds, true); } foreach (is_array($embeds) ? $embeds : [] as $block) { if (is_array($block)) { echo embed($block); } } ?>
    </article><?php endforeach; ?></section><aside><h2>Drop us a note</h2><p>Every submission lands in the WordPress inbox.</p><?php foreach (records('zpl_form', 10) as $form) : if ($form['status'] !== 'active') { continue; } ?><div class="public-form" data-form-id="<?php echo (int) $form['id']; ?>"></div><?php endforeach; ?><p class="fine">Search uses WordPress keyword matching. External AI and syndication services are optional connections.</p></aside></main>
    <footer>Open source examples. Real WordPress underneath.</footer><script src="<?php echo esc_url($assets . 'workshop.js'); ?>" defer></script></body></html><?php
    exit;
}

add_action('admin_enqueue_scripts', static function (): void {
    if (get_current_screen()?->post_type === ENTRY_TYPE) {
        wp_enqueue_script('typedpress-plugin-field-kit', plugin_dir_url(__FILE__) . 'field-kit.js', ['acf-input'], VERSION, true);
    }
});

function form_editor(): void {
    $id = absint($_GET['form_id'] ?? 0);
    $definition = $id && require_post($id, 'zpl_form') ? stored($id) : [
        'name' => 'Contact', 'pages' => [['title' => 'Your note', 'fields' => [
            ['name' => 'email', 'label' => 'Email', 'type' => 'email', 'required' => true],
            ['name' => 'message', 'label' => 'Message', 'type' => 'textarea', 'required' => true],
        ]]], 'settings' => ['confirmationMessage' => 'Thanks — your note is saved.'],
    ];
    echo '<h2>Forms</h2><p>';
    foreach (records('zpl_form', 50) as $form) {
        echo '<a href="' . esc_url(admin_url('admin.php?page=typedpress-plugin-lab&form_id=' . $form['id'])) . '">' . esc_html($form['name']) . '</a> · ';
    }
    echo '<a href="' . esc_url(admin_url('admin.php?page=typedpress-plugin-lab')) . '">New form</a></p><form method="post">';
    wp_nonce_field('tp_plugin_form');
    echo '<input type="hidden" name="form_id" value="' . $id . '"><p><label>Form definition<br><textarea name="form_definition" rows="18" class="large-text code">' . esc_textarea(wp_json_encode($definition, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)) . '</textarea></label></p>';
    submit_button($id ? 'Update form' : 'Create form');
    echo '</form><h3>Inbox</h3><table class="widefat striped"><thead><tr><th>Form</th><th>Status</th><th>Submitted</th><th>Data</th></tr></thead><tbody>';
    foreach (records('zpl_submit', 20) as $row) {
        echo '<tr><td>' . (int) $row['formId'] . '</td><td>' . esc_html($row['status']) . '</td><td>' . esc_html($row['createdAt']) . '</td><td><pre>' . esc_html(wp_json_encode($row['data'], JSON_PRETTY_PRINT)) . '</pre></td></tr>';
    }
    echo '</tbody></table>';
}
