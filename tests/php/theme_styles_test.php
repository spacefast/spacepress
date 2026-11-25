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
    wp_dequeue_style('spacepress-theme');
    wp_deregister_style('spacepress-theme');
    \SpacePress\Wp\ThemeStyles::enqueue();
    \SpacePress\Wp\ThemeStyles::enqueue();
    $after = wp_styles()->get_data('spacepress-theme', 'after');
    eq('the semantic sheet is enqueued once', count($after), 1);

    return implode('', $after);
};

check('normal WordPress pages do not enqueue app aliases', !wp_style_is('spacepress-theme', 'enqueued'));
$before = $css();
foreach ([
    '--sp--color--background:var(--wp--preset--color--paper);',
    '--sp--color--foreground:#112233;',
    '--sp--color--link:#234567;',
    '--sp--font-family--body:Georgia, serif;',
    '--sp--font-size--body:1.125rem;',
    '--sp--line-height--body:1.8;',
    '--sp--spacing--block:2rem;',
    '--sp--spacing--page:3rem;',
    '--sp--width--content:44rem;',
    '--sp--width--wide:80rem;',
] as $declaration) {
    check('active theme: ' . $declaration, str_contains($before, $declaration), $before);
}

$themeData['styles']['elements']['link']['color']['text'] = ['ref' => 'styles.color.text'];
$referenced = $css();
check('theme references resolve against the merged styles', str_contains($referenced, '--sp--color--link:#112233;'), $referenced);
$themeData['styles']['elements']['link']['color']['text'] = '#234567';
foreach ([
    'rgba(10,20,30,0.8)',
    'rgb(10 20 30 / 80%)',
    'hsl(120 30% 50%)',
    'oklch(60% 0.1 120)',
    'color-mix(in srgb, var(--wp--preset--color--paper), rgba(10,20,30,0.8))',
] as $color) {
    $themeData['styles']['color']['background'] = $color;
    $colored = $css();
    check('CSS color functions remain usable: ' . $color, str_contains($colored, '--sp--color--background:' . $color . ';'), $colored);
}
foreach (['rgba(10,20,30,expression(alert(1)))', 'rgba(10,20,30,0.8);color:red', 'rgba(10,20,30,/*comment*/0.8)', 'rgba(10,20,30,0.8\\9)', 'color-mix(in srgb, url(https://example.test/x), red)'] as $color) {
    $themeData['styles']['color']['background'] = $color;
    $rejected = $css();
    check('unsafe color functions use the fallback', str_contains($rejected, '--sp--color--background:Canvas;'), $rejected);
}
$themeData['styles']['color']['background'] = 'var:preset|color|paper';
eq('color function allowance does not leak outside alias serialization', safecss_filter_attr('--sp--color--background:rgba(10,20,30,0.8)'), '');

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
foreach (['--sp--color--background:#ffeedc;', '--sp--color--foreground:#231100;', '--sp--color--link:#006644;',
    '--sp--font-family--body:monospace;', '--sp--font-size--body:1.5rem;', '--sp--spacing--block:4rem;', '--sp--width--content:52rem;'] as $declaration) {
    check('owner styles: ' . $declaration, str_contains($after, $declaration), $after);
}
check('owner styles keep unspecified theme values', str_contains($after, '--sp--line-height--body:1.8;') && str_contains($after, '--sp--width--wide:80rem;'), $after);

wp_update_post(['ID' => $post['ID'], 'post_content' => wp_json_encode(['version' => 3, 'isGlobalStylesUserThemeJSON' => true])]);
$themeData = ['version' => 3, 'styles' => ['color' => ['background' => 'red;}</style><script>injected</script>'], 'typography' => ['fontFamily' => 'serif;--injected:1']]];
add_filter('wp_theme_json_data_default', static fn (): WP_Theme_JSON_Data => new WP_Theme_JSON_Data(['version' => 3], 'default'));
$empty = $css();
foreach (['--sp--color--background:Canvas;', '--sp--color--foreground:CanvasText;', '--sp--font-family--body:inherit;', '--sp--font-size--body:inherit;', '--sp--spacing--block:1.5rem;', '--sp--width--content:40rem;'] as $declaration) {
    check('missing or unsafe values use defaults: ' . $declaration, str_contains($empty, $declaration), $empty);
}
check('theme values cannot close the style or inject declarations', !str_contains($empty, '<') && !str_contains($empty, 'injected'), $empty);

$site->destroy();
finish('theme_styles');
