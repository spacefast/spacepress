import type { Theme } from '@wordpress/core-data';

export const theme: Theme = {
	stylesheet: 'twentyeleven',
	template: 'twentyeleven',
	requires_php: '5.2.4',
	requires_wp: '3.2',
	textdomain: 'twentyeleven',
	version: '4.9',
	screenshot:
		'http://localhost:9001/wp-content/themes/twentyeleven/screenshot.png',
	author: {
		raw: 'the WordPress team',
		rendered: '<a href="https://wordpress.org/">the WordPress team</a>',
	},
	author_uri: {
		raw: 'https://wordpress.org/',
		rendered: 'https://wordpress.org/',
	},
	description: {
		raw: 'The 2011 theme for WordPress is sophisticated, lightweight, and adaptable. Make it yours with a custom menu, header image, and background -- then go further with available theme options for light or dark color scheme, custom link colors, and three layout choices. Twenty Eleven comes equipped with a Showcase page template that transforms your front page into a showcase to show off your best content, widget support galore (sidebar, three footer areas, and a Showcase page widget area), and a custom "Ephemera" widget to display your Aside, Link, Quote, or Status posts. Included are styles for print and for the admin editor, support for featured images (as custom header images on posts and pages and as large images on featured "sticky" posts), and special styles for six different post formats.',
		rendered:
			'The 2011 theme for WordPress is sophisticated, lightweight, and adaptable. Make it yours with a custom menu, header image, and background &#8212; then go further with available theme options for light or dark color scheme, custom link colors, and three layout choices. Twenty Eleven comes equipped with a Showcase page template that transforms your front page into a showcase to show off your best content, widget support galore (sidebar, three footer areas, and a Showcase page widget area), and a custom &#8220;Ephemera&#8221; widget to display your Aside, Link, Quote, or Status posts. Included are styles for print and for the admin editor, support for featured images (as custom header images on posts and pages and as large images on featured &#8220;sticky&#8221; posts), and special styles for six different post formats.',
	},
	name: {
		raw: 'Twenty Eleven',
		rendered: 'Twenty Eleven',
	},
	tags: {
		// @ts-expect-error - Mock data, raw can be string array but types expect string
		raw: [
			'blog',
			'one-column',
			'two-columns',
			'left-sidebar',
			'right-sidebar',
			'custom-background',
			'custom-colors',
			'custom-header',
			'custom-menu',
			'editor-style',
			'featured-image-header',
			'featured-images',
			'flexible-header',
			'footer-widgets',
			'full-width-template',
			'microformats',
			'post-formats',
			'rtl-language-support',
			'sticky-post',
			'theme-options',
			'translation-ready',
			'block-patterns',
		],
		rendered:
			'blog, one-column, two-columns, left-sidebar, right-sidebar, custom-background, custom-colors, custom-header, custom-menu, editor-style, featured-image-header, featured-images, flexible-header, footer-widgets, full-width-template, microformats, post-formats, rtl-language-support, sticky-post, theme-options, translation-ready, block-patterns',
	},
	theme_uri: {
		raw: 'https://wordpress.org/themes/twentyeleven/',
		rendered: 'https://wordpress.org/themes/twentyeleven/',
	},
	status: 'active',
	theme_supports: {
		'align-wide': false,
		'automatic-feed-links': true,
		'block-templates': false,
		'block-template-parts': false,
		'custom-background': {
			'default-image': '',
			'default-preset': 'default',
			'default-position-x': 'left',
			// @ts-expect-error - Mock data, 'top' is valid but types restrict to 'left'|'center'|'right'
			'default-position-y': 'top',
			'default-size': 'auto',
			'default-repeat': 'repeat',
			'default-attachment': 'scroll',
			'default-color': 'e2e2e2',
		},
		'custom-header': {
			'default-image': '',
			'random-default': true,
			width: 1000,
			height: 288,
			'flex-height': true,
			'flex-width': false,
			'default-text-color': '000',
			'header-text': true,
			uploads: true,
			video: false,
		},
		'custom-logo': false,
		'customize-selective-refresh-widgets': true,
		'dark-editor-style': false,
		'disable-custom-colors': false,
		'disable-custom-font-sizes': false,
		'disable-custom-gradients': false,
		'disable-layout-styles': false,
		'editor-color-palette': [
			{
				name: 'Blue',
				slug: 'blue',
				color: '#1982d1',
			},
			{
				name: 'Black',
				slug: 'black',
				color: '#000',
			},
			{
				name: 'Dark Gray',
				slug: 'dark-gray',
				color: '#373737',
			},
			{
				name: 'Medium Gray',
				slug: 'medium-gray',
				color: '#666',
			},
			{
				name: 'Light Gray',
				slug: 'light-gray',
				color: '#e2e2e2',
			},
			{
				name: 'White',
				slug: 'white',
				color: '#fff',
			},
		],
		'editor-font-sizes': false,
		'editor-gradient-presets': false,
		'editor-spacing-sizes': false,
		'editor-styles': true,
		html5: false,
		formats: [
			'standard',
			'aside',
			'link',
			'gallery',
			'status',
			'quote',
			'image',
		],
		'post-thumbnails': true,
		'responsive-embeds': true,
		'title-tag': false,
		'wp-block-styles': true,
	},
	is_block_theme: false,
	stylesheet_uri: 'http://localhost:9001/wp-content/themes/twentyeleven',
	template_uri: 'http://localhost:9001/wp-content/themes/twentyeleven',
	default_template_types: [
		{
			title: 'Index',
			description:
				'Used as a fallback template for all pages when a more specific template is not defined.',
			slug: 'index',
		},
		{
			title: 'Blog Home',
			description:
				'Displays the latest posts as either the site homepage or as the "Posts page" as defined under reading settings. If it exists, the Front Page template overrides this template when posts are shown on the homepage.',
			slug: 'home',
		},
		{
			title: 'Front Page',
			description:
				"Displays your site's homepage, whether it is set to display latest posts or a static page. The Front Page template takes precedence over all templates.",
			slug: 'front-page',
		},
		{
			title: 'Single Entries',
			description:
				'Displays any single entry, such as a post or a page. This template will serve as a fallback when a more specific template (e.g. Single Post, Page, or Attachment) cannot be found.',
			slug: 'singular',
		},
		{
			title: 'Single Posts',
			description:
				'Displays a single post on your website unless a custom template has been applied to that post or a dedicated template exists.',
			slug: 'single',
		},
		{
			title: 'Pages',
			description:
				'Displays a static page unless a custom template has been applied to that page or a dedicated template exists.',
			slug: 'page',
		},
		{
			title: 'All Archives',
			description:
				'Displays any archive, including posts by a single author, category, tag, taxonomy, custom post type, and date. This template will serve as a fallback when more specific templates (e.g. Category or Tag) cannot be found.',
			slug: 'archive',
		},
		{
			title: 'Author Archives',
			description:
				"Displays a single author's post archive. This template will serve as a fallback when a more specific template (e.g. Author: Admin) cannot be found.",
			slug: 'author',
		},
		{
			title: 'Category Archives',
			description:
				'Displays a post category archive. This template will serve as a fallback when a more specific template (e.g. Category: Recipes) cannot be found.',
			slug: 'category',
		},
		{
			title: 'Taxonomy',
			description:
				'Displays a custom taxonomy archive. Like categories and tags, taxonomies have terms which you use to classify things. For example: a taxonomy named "Art" can have multiple terms, such as "Modern" and "18th Century." This template will serve as a fallback when a more specific template (e.g. Taxonomy: Art) cannot be found.',
			slug: 'taxonomy',
		},
		{
			title: 'Date Archives',
			description:
				'Displays a post archive when a specific date is visited (e.g., example.com/2023/).',
			slug: 'date',
		},
		{
			title: 'Tag Archives',
			description:
				'Displays a post tag archive. This template will serve as a fallback when a more specific template (e.g. Tag: Pizza) cannot be found.',
			slug: 'tag',
		},
		{
			title: 'Attachment Pages',
			description:
				'Displays when a visitor views the dedicated page that exists for any media attachment.',
			slug: 'attachment',
		},
		{
			title: 'Search Results',
			description:
				'Displays when a visitor performs a search on your website.',
			slug: 'search',
		},
		{
			title: 'Privacy Policy',
			description: "Displays your site's Privacy Policy page.",
			slug: 'privacy-policy',
		},
		{
			title: 'Page: 404',
			description:
				'Displays when a visitor views a non-existent page, such as a dead link or a mistyped URL.',
			slug: '404',
		},
		{
			title: 'Post Format: Standard',
			description: 'Displays the Standard post format archive.',
			slug: 'taxonomy-post_format-post-format-standard',
		},
		{
			title: 'Post Format: Aside',
			description: 'Displays the Aside post format archive.',
			slug: 'taxonomy-post_format-post-format-aside',
		},
		{
			title: 'Post Format: Chat',
			description: 'Displays the Chat post format archive.',
			slug: 'taxonomy-post_format-post-format-chat',
		},
		{
			title: 'Post Format: Gallery',
			description: 'Displays the Gallery post format archive.',
			slug: 'taxonomy-post_format-post-format-gallery',
		},
		{
			title: 'Post Format: Link',
			description: 'Displays the Link post format archive.',
			slug: 'taxonomy-post_format-post-format-link',
		},
		{
			title: 'Post Format: Image',
			description: 'Displays the Image post format archive.',
			slug: 'taxonomy-post_format-post-format-image',
		},
		{
			title: 'Post Format: Quote',
			description: 'Displays the Quote post format archive.',
			slug: 'taxonomy-post_format-post-format-quote',
		},
		{
			title: 'Post Format: Status',
			description: 'Displays the Status post format archive.',
			slug: 'taxonomy-post_format-post-format-status',
		},
		{
			title: 'Post Format: Video',
			description: 'Displays the Video post format archive.',
			slug: 'taxonomy-post_format-post-format-video',
		},
		{
			title: 'Post Format: Audio',
			description: 'Displays the Audio post format archive.',
			slug: 'taxonomy-post_format-post-format-audio',
		},
	],
	default_template_part_areas: [
		{
			area: 'uncategorized',
			label: 'General',
			description:
				'General templates often perform a specific role like displaying post content, and are not tied to any particular area.',
			icon: 'layout',
			area_tag: 'div',
		},
		{
			area: 'header',
			label: 'Header',
			description:
				'The Header template defines a page area that typically contains a title, logo, and main navigation.',
			icon: 'header',
			area_tag: 'header',
		},
		{
			area: 'footer',
			label: 'Footer',
			description:
				'The Footer template defines a page area that typically contains site credits, social links, or any other combination of blocks.',
			icon: 'footer',
			area_tag: 'footer',
		},
	],
	_links: {
		self: [
			{
				href: 'http://localhost:9001/wp-json/wp/v2/themes/twentyeleven',
				targetHints: {
					allow: [ 'POST', 'PUT', 'PATCH', 'GET' ],
				},
			},
		],
		collection: [
			{
				href: 'http://localhost:9001/wp-json/wp/v2/themes',
			},
		],
	},
	permissions: {
		delete: false,
		update: true,
	},
	update_info: {
		has_update: false,
		current_version: '4.9',
		new_version: null,
		update_url: null,
		package: null,
	},
	auto_updates: {
		enabled: false,
		supported: true,
		forced: null,
	},
};
