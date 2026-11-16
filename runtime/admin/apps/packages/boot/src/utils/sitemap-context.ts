import { select, resolveSelect } from '@wordpress/data';
import type {
	PostTypeInfo,
	ExpandedRoute,
	EnrichedMenuItem,
	RelatedRoutes,
	SitemapData,
} from '@typedpress-admin/ai-agent';
import type { Route, FlatMenuItem } from '../store/types';

const CORE_STORE = 'core';

// Track if we've already preloaded to avoid duplicate requests, especially in strict mode
let hasPreloadedSitemapData = false;

/**
 * Preload data needed for core sitemap context
 * This ensures necessary data is loaded before building the sitemap
 */
export async function preloadSitemapData(): Promise< void > {
	if ( hasPreloadedSitemapData ) {
		return;
	}

	hasPreloadedSitemapData = true;

	try {
		await resolveSelect( CORE_STORE ).getPostTypes( { per_page: -1 } );
	} catch {
		hasPreloadedSitemapData = false;
	}
}

/**
 * Get all post types that should be shown in the UI
 */
export function getAvailablePostTypes(): PostTypeInfo[] {
	try {
		const coreSelect = select( CORE_STORE ) as any;
		const postTypes = coreSelect?.getPostTypes?.( {
			per_page: -1,
		} ) as any[];

		if ( ! postTypes || ! Array.isArray( postTypes ) ) {
			return [];
		}

		const filtered = postTypes.filter(
			( postType ) =>
				postType.visibility?.show_ui !== false &&
				postType.rest_base &&
				postType.viewable !== false
		);

		return filtered.map( ( postType ) => ( {
			slug: postType.slug,
			label: postType.labels?.name || postType.name,
			restBase: postType.rest_base,
			description: postType.description,
			viewable: postType.viewable,
		} ) );
	} catch {
		return [];
	}
}

/**
 * Expand a route pattern with actual post types
 * @param routePath - Route path pattern
 * @param postTypes - Available post types
 */
function expandRoutePattern(
	routePath: string,
	postTypes: PostTypeInfo[]
): ExpandedRoute[] {
	const expandedRoutes: ExpandedRoute[] = [];

	// Handle /types/$type/new pattern
	if ( routePath.includes( '/types/$type/new' ) ) {
		for ( const postType of postTypes ) {
			// Skip product type - it has special handling
			if ( postType.slug === 'product' ) {
				continue;
			}

			expandedRoutes.push( {
				path: routePath.replace( '$type', postType.slug ),
				action: 'create',
				entityType: postType.slug,
				description: `Create new ${ postType.label }`,
			} );
		}
	}

	// Handle /types/$type/edit/$id pattern
	if ( routePath.includes( '/types/$type/edit/$id' ) ) {
		for ( const postType of postTypes ) {
			// Skip product type - it has special handling
			if ( postType.slug === 'product' ) {
				continue;
			}

			expandedRoutes.push( {
				path: routePath
					.replace( '$type', postType.slug )
					.replace( '$id', '{id}' ),
				action: 'edit',
				entityType: postType.slug,
				description: `Edit ${ postType.label } by ID`,
			} );
		}
	}

	// Handle /types/$type/list/$slug pattern
	if ( routePath.includes( '/types/$type/list/$slug' ) ) {
		for ( const postType of postTypes ) {
			// Skip product type - it has special handling
			if ( postType.slug === 'product' ) {
				continue;
			}

			expandedRoutes.push( {
				path: routePath
					.replace( '$type', postType.slug )
					.replace( '$slug', 'all' ),
				action: 'list',
				entityType: postType.slug,
				description: `View all ${ postType.label }`,
			} );
		}
	}

	return expandedRoutes;
}

/**
 * Extract entity type from a path
 * Examples:
 *   /types/post/list/all -> post
 *   /types/page -> page
 *   /types/post/taxonomies/category -> null (taxonomy, not entity)
 * @param path - Route path
 */
function extractEntityType( path: string ): string | null {
	// Exclude taxonomy paths - they shouldn't get entity routes
	if ( path.includes( '/taxonomies/' ) ) {
		return null;
	}

	// Handle standard /types/$type routes (with or without trailing content)
	const typesMatch = path.match( /\/types\/([^/]+)(?:\/|$)/ );
	if ( typesMatch ) {
		return typesMatch[ 1 ];
	}

	if ( path.includes( '/woocommerce/products' ) ) {
		return 'product';
	}

	if ( path.includes( '/woocommerce/coupons' ) ) {
		return 'shop_coupon';
	}

	return null;
}

/**
 * Enrich menu items with related routes
 * @param menuItems      - Flat menu items
 * @param expandedRoutes - Expanded routes
 */
export function enrichMenuItems(
	menuItems: FlatMenuItem[],
	expandedRoutes: ExpandedRoute[]
): EnrichedMenuItem[] {
	return menuItems.map( ( menuItem ) => {
		const entityType = extractEntityType( menuItem.to );

		if ( ! entityType ) {
			// No entity type found, return as-is
			return {
				id: menuItem.id,
				to: menuItem.to,
				label: menuItem.label,
				parent: menuItem.parent || null,
			};
		}

		// Find related routes for this entity type
		const relatedRoutes: RelatedRoutes = {};

		for ( const route of expandedRoutes ) {
			if ( route.entityType !== entityType ) {
				continue;
			}

			if ( route.action === 'create' ) {
				relatedRoutes.create = route.path;
			} else if ( route.action === 'edit' ) {
				relatedRoutes.edit = route.path;
			} else if ( route.action === 'list' ) {
				relatedRoutes.list = route.path;
			}
		}

		const enriched: EnrichedMenuItem = {
			id: menuItem.id,
			to: menuItem.to,
			label: menuItem.label,
			parent: menuItem.parent || null,
		};

		// Only add relatedRoutes if we found any
		if ( Object.keys( relatedRoutes ).length > 0 ) {
			enriched.relatedRoutes = relatedRoutes;
		}

		return enriched;
	} );
}

/**
 * Build expanded routes from registered routes and post types
 * @param registeredRoutes - Routes from store
 * @param postTypes        - Available post types
 */
function buildExpandedRoutes(
	registeredRoutes: Route[],
	postTypes: PostTypeInfo[]
): ExpandedRoute[] {
	const expandedRoutes: ExpandedRoute[] = [];

	for ( const route of registeredRoutes ) {
		const expanded = expandRoutePattern( route.path, postTypes );
		expandedRoutes.push( ...expanded );
	}

	return expandedRoutes;
}

/**
 * Build complete core sitemap data from routes and menu items
 * This is the main function called by the getData closure in the context entry.
 * App-specific extensions (e.g., WooCommerce) should register separate context entries.
 *
 * @param routes    - Routes from store
 * @param menuItems - Menu items from store
 */
export function buildSitemapData(
	routes: Route[],
	menuItems: FlatMenuItem[]
): SitemapData {
	try {
		const postTypes = getAvailablePostTypes();
		const expandedRoutes = buildExpandedRoutes( routes, postTypes );
		const enrichedMenuItems = enrichMenuItems( menuItems, expandedRoutes );

		return {
			menuItems: enrichedMenuItems,
			postTypes,
			expandedRoutes,
		};
	} catch {
		// Return minimal valid sitemap on error
		return {
			menuItems: [],
			postTypes: [],
			expandedRoutes: [],
		};
	}
}
