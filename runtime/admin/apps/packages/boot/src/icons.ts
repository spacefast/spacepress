import {
	archive,
	box,
	brush,
	category,
	chartBar,
	code,
	commentContent,
	file,
	globe,
	grid,
	home,
	image,
	key,
	layout,
	listView,
	lock,
	navigation,
	page,
	paragraph,
	payment,
	people,
	plugins,
	postContent,
	postList,
	settings,
	shield,
	store,
	styles,
	table,
	tag,
	tool,
	verse,
	wordpress,
} from '@wordpress/icons';
import type { FlatMenuItem, IconType } from './store/types';

/**
 * Named SpacePress icons and common WordPress Dashicons mapped to `@wordpress/icons` SVGs.
 */
const NAMED_ICONS: Record< string, IconType > = {
	home,
	dashboard: home,
	page,
	pages: page,
	post: verse,
	verse,
	book: postContent,
	docs: postContent,
	postContent,
	postList,
	list: postList,
	listView,
	table,
	database: table,
	grid,
	image,
	media: image,
	brush,
	design: brush,
	settings,
	cog: settings,
	people,
	users: people,
	plugins,
	comment: commentContent,
	comments: commentContent,
	commentContent,
	store,
	commerce: store,
	cart: store,
	products: store,
	globe,
	globals: globe,
	shield,
	identity: shield,
	lock,
	key,
	tool,
	tools: tool,
	chartBar,
	analytics: chartBar,
	layout,
	box,
	archive,
	tag,
	category,
	code,
	file,
	wordpress,
	styles,
	navigation,
	payment,
	paragraph,

	// Common WordPress Dashicons mapped to crisp SVG equivalents.
	'admin-home': home,
	'admin-page': page,
	'admin-post': verse,
	'admin-media': image,
	'admin-comments': commentContent,
	'admin-appearance': brush,
	'admin-plugins': plugins,
	'admin-users': people,
	'admin-tools': tool,
	'admin-settings': settings,
	'admin-generic': settings,
	'admin-site': globe,
	'admin-site-alt3': globe,
	'admin-network': globe,
	'admin-customizer': styles,
	'admin-links': navigation,
	'book-alt': postContent,
	'chart-bar': chartBar,
	'chart-area': chartBar,
	'chart-line': chartBar,
	'chart-pie': chartBar,
	'editor-code': code,
	'editor-table': table,
	'grid-view': grid,
	'list-view': listView,
	'media-document': file,
	'media-archive': archive,
	'shield-alt': shield,
	'wordpress-alt': wordpress,
	groups: people,
	networking: globe,
	'products-alt': store,
	money: payment,
	'money-alt': payment,
	art: brush,
	category_icon: category,
};

/**
 * Resolve a SpacePress icon name or `dashicons-*` string to an `@wordpress/icons` SVG.
 */
export function resolveNamedIcon( name: string ): IconType | undefined {
	const trimmed = name.trim();
	if ( ! trimmed ) {
		return undefined;
	}
	if ( trimmed in NAMED_ICONS ) {
		return NAMED_ICONS[ trimmed ];
	}
	if ( trimmed.startsWith( 'dashicons-' ) ) {
		const slug = trimmed.slice( 'dashicons-'.length );
		if ( slug in NAMED_ICONS ) {
			return NAMED_ICONS[ slug ];
		}
	}
	return undefined;
}

/**
 * Updates menu items with modern SVG icons from @wordpress/icons.
 * This function should be called after menu items are registered to replace
 * Dashicons with optimized SVG icons.
 *
 * @param updateMenuItem - Function to update a menu item.
 */
export function updateMenuIcons(
	updateMenuItem: ( itemId: string, item: Partial< FlatMenuItem > ) => void
) {
	// Core menu items
	updateMenuItem( 'dashboard', {
		icon: home,
	} );

	updateMenuItem( 'settings', {
		icon: settings,
	} );

	updateMenuItem( 'settings-general', {
		icon: settings,
	} );

	updateMenuItem( 'settings-users', {
		icon: people,
	} );

	updateMenuItem( 'settings-reading', {
		icon: paragraph,
	} );

	updateMenuItem( 'settings-discussion', {
		icon: commentContent,
	} );

	updateMenuItem( 'settings-plugins', {
		icon: plugins,
	} );

	updateMenuItem( 'settings-tools', {
		icon: tool,
	} );

	updateMenuItem( 'settings-deployments', {
		icon: archive,
	} );

	updateMenuItem( 'settings-experiments', {
		icon: tool,
	} );

	updateMenuItem( 'design', {
		icon: brush,
	} );

	updateMenuItem( 'design-styles', {
		icon: styles,
	} );

	updateMenuItem( 'design-templates', {
		icon: layout,
	} );

	updateMenuItem( 'design-navigation', {
		icon: navigation,
	} );

	updateMenuItem( 'design-themes', {
		icon: brush,
	} );

	// Common post types and core sections
	updateMenuItem( 'page', {
		icon: page,
	} );

	updateMenuItem( 'post', {
		icon: verse,
	} );

	updateMenuItem( 'plugins', {
		icon: plugins,
	} );

	updateMenuItem( 'attachment', {
		icon: image,
	} );

	updateMenuItem( 'media', {
		icon: image,
	} );

	updateMenuItem( 'comment', {
		icon: commentContent,
	} );

	updateMenuItem( 'comments', {
		icon: commentContent,
	} );

	updateMenuItem( 'globals', {
		icon: globe,
	} );

	updateMenuItem( 'tools', {
		icon: tool,
	} );

	updateMenuItem( 'users', {
		icon: people,
	} );

	updateMenuItem( 'users-identity', {
		icon: shield,
	} );

	updateMenuItem( 'classic', {
		icon: wordpress,
	} );

	// WooPayments Finance section
	updateMenuItem( 'finance', {
		icon: payment,
	} );
}
