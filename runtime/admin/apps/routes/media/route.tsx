import { notFound } from '@wordpress/route';
import { viewToQuery } from '@zero-admin/admin-toolkit';
import { preloadFieldCollections } from '@zero-admin/core-data-next';
import { resolveSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { MediaEditor } from '../attachment/media-editor';
import { ensureView } from './view-utils';

export const route = {
	inspector: async ( {
		params,
		search,
	}: {
		params: Record< string, never >;
		search: {
			slug?: string;
			postIds?: string[];
			edit?: boolean;
			page?: number;
			search?: string;
		};
	} ) => {
		const view = await ensureView( 'attachment', search?.slug, search );
		if ( view.type === 'list' ) {
			return;
		}
		return search.edit === true;
	},
	canvas: async ( {
		params,
		search,
	}: {
		params: Record< string, never >;
		search: {
			slug?: string;
			postIds?: string[];
			edit?: boolean;
			page?: number;
			search?: string;
		};
	} ) => {
		const view = await ensureView( 'attachment', search?.slug, search );
		// Only show canvas if it's a list view type
		if ( view.type !== 'list' ) {
			return;
		}

		const posts = ( await resolveSelect( coreStore ).getEntityRecords(
			'postType',
			'attachment',
			viewToQuery( view, 'attachment' )
		) ) as Array< { id: string | number } > | null;
		const firstPost = posts?.[ 0 ];

		if ( ! firstPost ) {
			return { postType: 'attachment', isPreview: true };
		}

		return {
			postType: 'attachment',
			postId: search.postIds ? search.postIds[ 0 ] : firstPost.id,
			isPreview: true,
			component: MediaEditor,
		};
	},
	loader: async ( {
		params,
		search,
	}: {
		params: Record< string, never >;
		search: { slug?: string; page?: number; search?: string };
	} ) => {
		const view = await ensureView( 'attachment', search?.slug, search );
		const query = viewToQuery( view, 'attachment' );

		const preloadTermsPromise = resolveSelect( coreStore )
			.getPostType( 'attachment' )
			.then( ( postTypeObject: any ) =>
				postTypeObject?.taxonomies?.length
					? resolveSelect( coreStore ).getTaxonomies( {
							type: 'attachment',
					  } )
					: []
			)
			.then( ( postTypeTaxonomies: any[] | null ) =>
				Promise.all(
					( postTypeTaxonomies ?? [] )
						.filter(
							( taxonomy ) =>
								taxonomy.show_in_rest || taxonomy.rest_base
						)
						.map( ( taxonomy ) =>
							resolveSelect( coreStore ).getEntityRecords(
								'taxonomy',
								taxonomy.slug,
								{ per_page: -1 }
							)
						)
				)
			);

		// Post type already preloaded in beforeLoad
		await Promise.all( [
			resolveSelect( coreStore ).getEntityRecords(
				'postType',
				'attachment',
				query
			),
			// Preload users data (what usePostFields needs for author field)
			resolveSelect( coreStore ).getEntityRecords( 'root', 'user', {
				per_page: -1,
			} ),
			// Preload post statuses to render tabbed status selector
			resolveSelect( coreStore ).getEntityRecords( 'root', 'status', {
				per_page: -1,
			} ),
			resolveSelect( coreStore ).canUser( 'create', {
				kind: 'postType',
				name: 'attachment',
			} ),
			preloadTermsPromise,
			preloadFieldCollections( 'postType', 'attachment' ),
		] );
	},
	beforeLoad: async () => {
		try {
			const postTypeObject =
				await resolveSelect( coreStore ).getPostType( 'attachment' );

			if ( ! postTypeObject?.visibility?.show_ui ) {
				throw notFound();
			}
		} catch {
			throw notFound();
		}
	},
};
