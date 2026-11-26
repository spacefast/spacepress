import { notFound } from '@wordpress/route';
import {
	loadViewConfig,
	preloadFieldCollections,
} from '@spacepress-admin/core-data-next';
import { resolveSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';

export const route = {
	beforeLoad: async ( {
		params,
	}: {
		params: { type: string; taxonomy: string; termId: string };
	} ) => {
		const termId = parseInt( params.termId, 10 );

		if ( Number.isNaN( termId ) ) {
			throw notFound();
		}

		try {
			const [ , taxonomyObject, term ] = await Promise.all( [
				resolveSelect( coreStore ).getPostType( params.type ),
				resolveSelect( coreStore ).getTaxonomy( params.taxonomy ),
				resolveSelect( coreStore ).getEntityRecord(
					'taxonomy',
					params.taxonomy,
					termId
				),
			] );

			if (
				! taxonomyObject?.types.includes( params.type ) ||
				undefined === term
			) {
				throw notFound();
			}
		} catch {
			throw notFound();
		}
	},
	loader: async ( {
		params,
	}: {
		params: { taxonomy: string; termId: string };
	} ) => {
		const termId = parseInt( params.termId, 10 );

		await Promise.all( [
			preloadFieldCollections( 'taxonomy', params.taxonomy ),
			resolveSelect( coreStore ).getTaxonomy( params.taxonomy ),
			resolveSelect( coreStore ).getEntityRecord(
				'taxonomy',
				params.taxonomy,
				termId
			),
			resolveSelect( coreStore ).canUser( 'create', {
				kind: 'taxonomy',
				name: params.taxonomy,
			} ),
			loadViewConfig( 'taxonomy', params.taxonomy ),
		] );
	},
};
