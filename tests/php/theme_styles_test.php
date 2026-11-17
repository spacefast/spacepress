<?php

declare(strict_types=1);

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$site = wpSite('theme-styles', ['schema' => ['name' => 'theme-styles', 'collections' => []]]);
$themeData = [
    'version' => 3,
    'settings' => [
        'layout' => ['contentSize' => '44rem', 'wideSize' => '80rem'],
        'color' => ['palette' => [['slug' => 'paper', 'color' => '#fafafa', 'name' => 'Paper']]],
    ],
    'styles' => [
        'color' => ['background' => 'var:preset|color|paper', 'text' => '#112233'],
        'elements' => ['link' => ['color' => ['text' => '#234567']]],
        'typography' => ['fontFamily' => 'Georgia, serif', 'fontSize' => '1.125rem', 'lineHeight' => '1.8'],
        'spacing' => ['blockGap' => '2rem', 'padding' => ['left' => '3rem']],
    ],
];
add_filter('wp_theme_json_data_theme', static function () use (&$themeData): WP_Theme_JSON_Data {
    return new WP_Theme_JSON_Data($themeData, 'theme');
});
$css = static function (): string {
    wp_clean_theme_json_cache();
    wp_dequeue_style('typedpress-theme');
    wp_deregister_style('typedpress-theme');
    \TypedPress\Wp\ThemeStyles::enqueue();
    \TypedPress\Wp\ThemeStyles::enqueue();
    $after = wp_styles()->get_data('typedpress-theme', 'after');
    eq('the semantic sheet is enqueued once', count($after), 1);

    return implode('', $after);
};

check('normal WordPress pages do not enqueue app aliases', !wp_style_is('typedpress-theme', 'enqueued'));
$before = $css();
foreach ([
    '--tp--color--background:var(--wp--preset--color--paper);',
    '--tp--color--foreground:#112233;',
    '--tp--color--link:#234567;',
    '--tp--font-family--body:Georgia, serif;',
    '--tp--font-size--body:1.125rem;',
    '--tp--line-height--body:1.8;',
    '--tp--spacing--block:2rem;',
    '--tp--spacing--page:3rem;',
    '--tp--width--content:44rem;',
    '--tp--width--wide:80rem;',
] as $declaration) {
    check('active theme: ' . $declaration, str_contains($before, $declaration), $before);
}

// A Site Editor save changes the aliases without building the app again.
wp_set_current_user(1);
$post = WP_Theme_JSON_Resolver::get_user_data_from_wp_global_styles(wp_get_theme(), true);
wp_update_post(['ID' => $post['ID'], 'post_content' => wp_json_encode([
    'version' => 3, 'isGlobalStylesUserThemeJSON' => true,
    'settings' => ['layout' => ['contentSize' => '52rem']],
    'styles' => [
        'color' => ['background' => '#ffeedc', 'text' => '#231100'],
        'elements' => ['link' => ['color' => ['text' => '#006644']]],
        'typography' => ['fontFamily' => 'monospace', 'fontSize' => '1.5rem'],
        'spacing' => ['blockGap' => '4rem'],
    ],
])]);
$after = $css();
foreach (['--tp--color--background:#ffeedc;', '--tp--color--foreground:#231100;', '--tp--color--link:#006644;',
    '--tp--font-family--body:monospace;', '--tp--font-size--body:1.5rem;', '--tp--spacing--block:4rem;', '--tp--width--content:52rem;'] as $declaration) {
    check('owner styles: ' . $declaration, str_contains($after, $declaration), $after);
}
check('owner styles keep unspecified theme values', str_contains($after, '--tp--line-height--body:1.8;') && str_contains($after, '--tp--width--wide:80rem;'), $after);

wp_update_post(['ID' => $post['ID'], 'post_content' => wp_json_encode(['version' => 3, 'isGlobalStylesUserThemeJSON' => true])]);
$themeData = ['version' => 3, 'styles' => ['color' => ['background' => 'red;}</style><script>injected</script>'], 'typography' => ['fontFamily' => 'serif;--injected:1']]];
add_filter('wp_theme_json_data_default', static fn (): WP_Theme_JSON_Data => new WP_Theme_JSON_Data(['version' => 3], 'default'));
$empty = $css();
foreach (['--tp--color--background:Canvas;', '--tp--color--foreground:CanvasText;', '--tp--font-family--body:inherit;', '--tp--font-size--body:inherit;', '--tp--spacing--block:1.5rem;', '--tp--width--content:40rem;'] as $declaration) {
    check('missing or unsafe values use defaults: ' . $declaration, str_contains($empty, $declaration), $empty);
}
check('theme values cannot close the style or inject declarations', !str_contains($empty, '<') && !str_contains($empty, 'injected'), $empty);

$site->destroy();
finish('theme_styles');
