<?php

declare(strict_types=1);

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$site       = wpSite(
	'theme-styles',
	array(
		'schema' => array(
			'name'        => 'theme-styles',
			'collections' => array(),
		),
	)
);
$theme_data = array(
	'version'  => 3,
	'settings' => array(
		'layout' => array(
			'contentSize' => '44rem',
			'wideSize'    => '80rem',
		),
		'color'  => array(
			'palette' => array(
				array(
					'slug'  => 'paper',
					'color' => '#fafafa',
					'name'  => 'Paper',
				),
			),
		),
	),
	'styles'   => array(
		'color'      => array(
			'background' => 'var:preset|color|paper',
			'text'       => '#112233',
		),
		'elements'   => array( 'link' => array( 'color' => array( 'text' => '#234567' ) ) ),
		'typography' => array(
			'fontFamily' => 'Georgia, serif',
			'fontSize'   => '1.125rem',
			'lineHeight' => '1.8',
		),
		'spacing'    => array(
			'blockGap' => '2rem',
			'padding'  => array( 'left' => '3rem' ),
		),
	),
);
add_filter(
	'wp_theme_json_data_theme',
	static function () use ( &$theme_data ): WP_Theme_JSON_Data {
		return new WP_Theme_JSON_Data( $theme_data, 'theme' );
	}
);
$css = static function (): string {
	wp_clean_theme_json_cache();
	wp_dequeue_style( 'spacepress-theme' );
	wp_deregister_style( 'spacepress-theme' );
	\SpacePress\Wp\ThemeStyles::enqueue();
	\SpacePress\Wp\ThemeStyles::enqueue();
	$after = wp_styles()->get_data( 'spacepress-theme', 'after' );
	eq( 'the semantic sheet is enqueued once', count( $after ), 1 );

	return implode( '', $after );
};

check( 'normal WordPress pages do not enqueue app aliases', ! wp_style_is( 'spacepress-theme', 'enqueued' ) );
$before = $css();
foreach ( array(
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
) as $declaration ) {
	check( 'active theme: ' . $declaration, str_contains( $before, $declaration ), $before );
}

$theme_data['styles']['elements']['link']['color']['text'] = array( 'ref' => 'styles.color.text' );
$referenced = $css();
check( 'theme references resolve against the merged styles', str_contains( $referenced, '--sp--color--link:#112233;' ), $referenced );
$theme_data['styles']['elements']['link']['color']['text'] = '#234567';
foreach ( array(
	'rgba(10,20,30,0.8)',
	'rgb(10 20 30 / 80%)',
	'hsl(120 30% 50%)',
	'oklch(60% 0.1 120)',
	'color-mix(in srgb, var(--wp--preset--color--paper), rgba(10,20,30,0.8))',
) as $color ) {
	$theme_data['styles']['color']['background'] = $color;
	$colored                                     = $css();
	check( 'CSS color functions remain usable: ' . $color, str_contains( $colored, '--sp--color--background:' . $color . ';' ), $colored );
}
foreach ( array( 'rgba(10,20,30,expression(alert(1)))', 'rgba(10,20,30,0.8);color:red', 'rgba(10,20,30,/*comment*/0.8)', 'rgba(10,20,30,0.8\\9)', 'color-mix(in srgb, url(https://example.test/x), red)' ) as $color ) {
	$theme_data['styles']['color']['background'] = $color;
	$rejected                                    = $css();
	check( 'unsafe color functions use the fallback', str_contains( $rejected, '--sp--color--background:Canvas;' ), $rejected );
}
$theme_data['styles']['color']['background'] = 'var:preset|color|paper';
eq( 'color function allowance does not leak outside alias serialization', safecss_filter_attr( '--sp--color--background:rgba(10,20,30,0.8)' ), '' );

// A Site Editor save changes the aliases without building the app again.
wp_set_current_user( 1 );
$post = WP_Theme_JSON_Resolver::get_user_data_from_wp_global_styles( wp_get_theme(), true );
wp_update_post(
	array(
		'ID'           => $post['ID'],
		'post_content' => wp_json_encode(
			array(
				'version'                     => 3,
				'isGlobalStylesUserThemeJSON' => true,
				'settings'                    => array( 'layout' => array( 'contentSize' => '52rem' ) ),
				'styles'                      => array(
					'color'      => array(
						'background' => '#ffeedc',
						'text'       => '#231100',
					),
					'elements'   => array( 'link' => array( 'color' => array( 'text' => '#006644' ) ) ),
					'typography' => array(
						'fontFamily' => 'monospace',
						'fontSize'   => '1.5rem',
					),
					'spacing'    => array( 'blockGap' => '4rem' ),
				),
			)
		),
	)
);
$after = $css();
foreach ( array(
	'--sp--color--background:#ffeedc;',
	'--sp--color--foreground:#231100;',
	'--sp--color--link:#006644;',
	'--sp--font-family--body:monospace;',
	'--sp--font-size--body:1.5rem;',
	'--sp--spacing--block:4rem;',
	'--sp--width--content:52rem;',
) as $declaration ) {
	check( 'owner styles: ' . $declaration, str_contains( $after, $declaration ), $after );
}
check( 'owner styles keep unspecified theme values', str_contains( $after, '--sp--line-height--body:1.8;' ) && str_contains( $after, '--sp--width--wide:80rem;' ), $after );

wp_update_post(
	array(
		'ID'           => $post['ID'],
		'post_content' => wp_json_encode(
			array(
				'version'                     => 3,
				'isGlobalStylesUserThemeJSON' => true,
			)
		),
	)
);
$theme_data = array(
	'version' => 3,
	'styles'  => array(
		'color'      => array( 'background' => 'red;}</style><script>injected</script>' ),
		'typography' => array( 'fontFamily' => 'serif;--injected:1' ),
	),
);
add_filter( 'wp_theme_json_data_default', static fn (): WP_Theme_JSON_Data => new WP_Theme_JSON_Data( array( 'version' => 3 ), 'default' ) );
$empty = $css();
foreach ( array( '--sp--color--background:Canvas;', '--sp--color--foreground:CanvasText;', '--sp--font-family--body:inherit;', '--sp--font-size--body:inherit;', '--sp--spacing--block:1.5rem;', '--sp--width--content:40rem;' ) as $declaration ) {
	check( 'missing or unsafe values use defaults: ' . $declaration, str_contains( $empty, $declaration ), $empty );
}
check( 'theme values cannot close the style or inject declarations', ! str_contains( $empty, '<' ) && ! str_contains( $empty, 'injected' ), $empty );

$site->destroy();
finish( 'theme_styles' );
