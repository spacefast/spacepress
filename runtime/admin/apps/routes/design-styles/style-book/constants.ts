import { __ } from '@wordpress/i18n';
import type { Category, ColorGroup } from './types';

export const STYLE_BOOK_COLOR_GROUPS: ColorGroup[] = [
	{
		slug: 'theme-colors',
		title: __( 'Theme Colors', 'zero-admin' ),
		origin: 'theme',
		type: 'colors',
	},
	{
		slug: 'theme-gradients',
		title: __( 'Theme Gradients', 'zero-admin' ),
		origin: 'theme',
		type: 'gradients',
	},
	{
		slug: 'custom-colors',
		title: __( 'Custom Colors', 'zero-admin' ),
		origin: 'custom',
		type: 'colors',
	},
	{
		slug: 'custom-gradients',
		title: __( 'Custom Gradients', 'zero-admin' ),
		origin: 'custom', // User.
		type: 'gradients',
	},
	{
		slug: 'duotones',
		title: __( 'Duotones', 'zero-admin' ),
		origin: 'theme',
		type: 'duotones',
	},
	{
		slug: 'default-colors',
		title: __( 'Default Colors', 'zero-admin' ),
		origin: 'default',
		type: 'colors',
	},
	{
		slug: 'default-gradients',
		title: __( 'Default Gradients', 'zero-admin' ),
		origin: 'default',
		type: 'gradients',
	},
];

export const STYLE_BOOK_THEME_SUBCATEGORIES: Omit<
	Category,
	'subcategories'
>[] = [
	{
		slug: 'site-identity',
		title: __( 'Site Identity', 'zero-admin' ),
		blocks: [ 'core/site-logo', 'core/site-title', 'core/site-tagline' ],
	},
	{
		slug: 'design',
		title: __( 'Design', 'zero-admin' ),
		blocks: [ 'core/navigation', 'core/avatar', 'core/post-time-to-read' ],
		exclude: [ 'core/home-link', 'core/navigation-link' ],
	},
	{
		slug: 'posts',
		title: __( 'Posts', 'zero-admin' ),
		blocks: [
			'core/post-title',
			'core/post-excerpt',
			'core/post-author',
			'core/post-author-name',
			'core/post-author-biography',
			'core/post-date',
			'core/post-terms',
			'core/term-description',
			'core/query-title',
			'core/query-no-results',
			'core/query-pagination',
			'core/query-numbers',
		],
	},
	{
		slug: 'comments',
		title: __( 'Comments', 'zero-admin' ),
		blocks: [
			'core/comments-title',
			'core/comments-pagination',
			'core/comments-pagination-numbers',
			'core/comments',
			'core/comments-author-name',
			'core/comment-content',
			'core/comment-date',
			'core/comment-edit-link',
			'core/comment-reply-link',
			'core/comment-template',
			'core/post-comments-count',
			'core/post-comments-link',
		],
	},
];

export const STYLE_BOOK_CATEGORIES: Category[] = [
	{
		slug: 'overview',
		title: __( 'Overview', 'zero-admin' ),
		blocks: [],
	},
	{
		slug: 'text',
		title: __( 'Text', 'zero-admin' ),
		blocks: [
			'core/post-content',
			'core/home-link',
			'core/navigation-link',
		],
	},
	{
		slug: 'colors',
		title: __( 'Colors', 'zero-admin' ),
		blocks: [],
	},
	{
		slug: 'theme',
		title: __( 'Theme', 'zero-admin' ),
		subcategories: STYLE_BOOK_THEME_SUBCATEGORIES,
	},
	{
		slug: 'media',
		title: __( 'Media', 'zero-admin' ),
		blocks: [ 'core/post-featured-image' ],
	},
	{
		slug: 'widgets',
		title: __( 'Widgets', 'zero-admin' ),
		blocks: [],
	},
	{
		slug: 'embed',
		title: __( 'Embeds', 'zero-admin' ),
		include: [],
	},
];

// Style book preview subcategories for all blocks section.
export const STYLE_BOOK_ALL_BLOCKS_SUBCATEGORIES: Category[] = [
	...STYLE_BOOK_THEME_SUBCATEGORIES,
	{
		slug: 'media',
		title: __( 'Media', 'zero-admin' ),
		blocks: [ 'core/post-featured-image' ],
	},
	{
		slug: 'widgets',
		title: __( 'Widgets', 'zero-admin' ),
		blocks: [],
	},
	{
		slug: 'embed',
		title: __( 'Embeds', 'zero-admin' ),
		include: [],
	},
];

// Style book preview categories are organized slightly differently to the editor ones.
export const STYLE_BOOK_PREVIEW_CATEGORIES: Category[] = [
	{
		slug: 'overview',
		title: __( 'Overview', 'zero-admin' ),
		blocks: [],
	},
	{
		slug: 'text',
		title: __( 'Text', 'zero-admin' ),
		blocks: [
			'core/post-content',
			'core/home-link',
			'core/navigation-link',
		],
	},
	{
		slug: 'colors',
		title: __( 'Colors', 'zero-admin' ),
		blocks: [],
	},
	{
		slug: 'blocks',
		title: __( 'All Blocks', 'zero-admin' ),
		blocks: [],
		subcategories: STYLE_BOOK_ALL_BLOCKS_SUBCATEGORIES,
	},
];

// Forming a "block formatting context" to prevent margin collapsing.
// @see https://developer.mozilla.org/en-US/docs/Web/Guide/CSS/Block_formatting_context
const ROOT_CONTAINER = `
	.is-root-container {
		display: flow-root;
	}
`;
// The content area of the Style Book is rendered within an iframe so that global styles
// are applied to elements within the entire content area. To support elements that are
// not part of the block previews, such as headings and layout for the block previews,
// additional CSS rules need to be passed into the iframe. These are hard-coded below.
// Note that button styles are unset, and then focus rules from the \`Button\` component are
// applied to the \`button\` element, targeted via \`.edit-site-style-book__example\`.
// This is to ensure that browser default styles for buttons are not applied to the previews.
export const STYLE_BOOK_IFRAME_STYLES = `
	body {
		position: relative;
		padding: 32px !important;
	}

	${ ROOT_CONTAINER }

	.zero-admin-style-book__examples {
		max-width: 1200px;
		margin: 0 auto;
	}

	.zero-admin-style-book__example {
	    max-width: 900px;
		border-radius: 2px;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 40px;
		padding: 16px;
		width: 100%;
		box-sizing: border-box;
		scroll-margin-top: 32px;
		scroll-margin-bottom: 32px;
		margin: 0 auto 40px auto;
	}

	.zero-admin-style-book__example.is-selected {
		box-shadow: 0 0 0 1px var(--wpds-color-stroke-focus-brand);
	}

	.zero-admin-style-book__example.is-disabled-example {
		pointer-events: none;
	}

	.zero-admin-style-book__example:focus:not(:disabled) {
		box-shadow: 0 0 0 var(--wpds-border-width-focus) var(--wpds-color-stroke-focus-brand);
		outline: 3px solid transparent;
	}

	.zero-admin-style-book__duotone-example > div:first-child {
		display: flex;
		aspect-ratio: 16 / 9;
		grid-row: span 1;
		grid-column: span 2;
	}
	.zero-admin-style-book__duotone-example img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.zero-admin-style-book__duotone-example > div:not(:first-child) {
		height: 20px;
		border: 1px solid color-mix( in srgb, currentColor 10%, transparent );
	}

	.zero-admin-style-book__color-example {
		border: 1px solid color-mix( in srgb, currentColor 10%, transparent );
	}

	.zero-admin-style-book__subcategory-title,
	.zero-admin-style-book__example-title {
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
		font-size: 13px;
		font-weight: normal;
		line-height: normal;
		margin: 0;
		text-align: left;
		padding-top: 8px;
		border-top: 1px solid color-mix( in srgb, currentColor 10%, transparent );
		color: color-mix( in srgb, currentColor 60%, transparent );
	}

	.zero-admin-style-book__subcategory-title {
		font-size: 16px;
		margin-bottom: 40px;
    	padding-bottom: 8px;
	}

	.zero-admin-style-book__example-preview {
		width: 100%;
	}

	.zero-admin-style-book__example-preview .block-editor-block-list__insertion-point,
	.zero-admin-style-book__example-preview .block-list-appender {
		display: none;
	}
	:where(.is-root-container > .wp-block:first-child) {
		margin-top: 0;
	}
	:where(.is-root-container > .wp-block:last-child) {
		margin-bottom: 0;
	}
`;
