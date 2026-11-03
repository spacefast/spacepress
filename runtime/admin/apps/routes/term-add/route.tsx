import { notFound } from '@wordpress/route';
import {
	loadViewConfig,
	preloadFieldCollections,
} from '@zero-admin/core-data-next';
import { resolveSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';

export const route = {
	beforeLoad: async ( {
		params,
	}: {
		params: { type: string; taxonomy: string };
	} ) => {
		try {
			const [ postType, taxonomyObject ] = await Promise.all( [
				resolveSelect( coreStore ).getPostType( params.type ),
				resolveSelect( coreStore ).getTaxonomy( params.taxonomy ),
			] );

			if (
				! postType ||
				! taxonomyObject ||
				! Array.isArray( taxonomyObject.types ) ||
				! taxonomyObject.types.includes( params.type )
			) {
				throw notFound();
			}
		} catch {
			throw notFound();
		}
	},
	loader: async ( { params }: { params: { taxonomy: string } } ) => {
		await Promise.all( [
			preloadFieldCollections( 'taxonomy', params.taxonomy ),
			resolveSelect( coreStore ).getTaxonomy( params.taxonomy ),
			resolveSelect( coreStore ).canUser( 'create', {
				kind: 'taxonomy',
				name: params.taxonomy,
			} ),
			loadViewConfig( 'taxonomy', params.taxonomy ),
		] );
	},
};
