import { preloadFieldCollections } from '@typedpress-admin/core-data-next';
import { resolveSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { viewToQuery } from './view-utils';

export const route = {
	loader: async ( { params }: { params: { slug: string } } ) => {
		await Promise.all( [
			preloadFieldCollections( 'root', 'plugin' ),
			resolveSelect( coreStore ).getEntityRecords(
				'root',
				'plugin',
				viewToQuery( params.slug )
			),
		] );
	},
};
