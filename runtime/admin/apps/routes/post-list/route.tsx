import { notFound } from '@wordpress/route';
import { viewToQuery } from '@typedpress-admin/admin-toolkit';
import { preloadFieldCollections } from '@typedpress-admin/core-data-next';
import { resolveSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { MediaEditor } from '../attachment/media-editor';
import { ensureView } from './view-utils';

export const route = {
	inspector: async ( {
		params,
		search,
	}: {
		params: { type: string; slug?: string };
		search: {
			postIds?: string[];
			edit?: boolean;
			page?: number;
			search?: string;
		};
	} ) => {
		const view = await ensureView( params.type, params.slug, search );
		if ( view.type === 'list' ) {
			return;
		}
		return search.edit === true;
	},
	canvas: async ( {
		params,
		search,
	}: {
		params: { type: string; slug?: string };
		search: {
			postIds?: string[];
			edit?: boolean;
			page?: number;
			search?: string;
		};
	} ) => {
		const view = await ensureView( params.type, params.slug, search );
		// Only show canvas if it's a list view type
		if ( view.type !== 'list' ) {
			return;
		}

		const posts = ( await resolveSelect( coreStore ).getEntityRecords(
			'postType',
			params.type,
			viewToQuery( view, params.type )
		) ) as Array< { id: string | number } > | null;
		const firstPost = posts?.[ 0 ];

		if ( ! firstPost ) {
			return { postType: params.type, isPreview: true };
		}

		return {
			postType: params.type,
			postId: search.postIds ? search.postIds[ 0 ] : firstPost.id,
			isPreview: true,
			component: params.type === 'attachment' ? MediaEditor : undefined,
		};
	},
	loader: async ( {
		params,
		search,
	}: {
		params: { type: string; slug?: string };
		search: { page?: number; search?: string };
	} ) => {
		const view = await ensureView( params.type, params.slug, search );
		const isClientSidePostType = params.type === 'wp_template';
		const query = {
			...viewToQuery( view, params.type ),
			...( isClientSidePostType ? { per_page: -1 } : {} ),
		};

		const preloadTermsPromise = resolveSelect( coreStore )
			.getPostType( params.type )
			.then( ( postTypeObject: any ) =>
				postTypeObject?.taxonomies?.length
					? resolveSelect( coreStore ).getTaxonomies( {
							type: params.type,
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
				params.type,
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
				name: params.type,
			} ),
			preloadTermsPromise,
			preloadFieldCollections( 'postType', params.type ),
		] );
	},
	beforeLoad: async ( { params }: { params: { type: string } } ) => {
		try {
			const postTypeObject = await resolveSelect( coreStore ).getPostType(
				params.type
			);

			if ( ! postTypeObject?.visibility?.show_ui ) {
				throw notFound();
			}
		} catch {
			throw notFound();
		}
	},
};
