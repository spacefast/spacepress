import {
	loadViewConfig,
	preloadFieldCollections,
} from '@typedpress-admin/core-data-next';
import { resolveSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { ensureView, viewToQuery } from './view-utils';

export const route = {
	inspector: async ( {
		params,
		search,
	}: {
		params: { slug?: string };
		search: {
			userIds?: string[];
			edit?: boolean;
			page?: number;
			search?: string;
		};
	} ) => {
		const view = await ensureView( params.slug, search );
		if ( view.type === 'list' ) {
			return;
		}
		return search.edit === true;
	},
	loader: async ( {
		params,
		search,
	}: {
		params: { slug?: string };
		search: { page?: number; search?: string };
	} ) => {
		const view = await ensureView( params.slug, search );
		const userQuery = viewToQuery( view );

		await Promise.all( [
			resolveSelect( coreStore ).getEntityRecords(
				'root',
				'user',
				userQuery
			),
			resolveSelect( coreStore ).canUser( 'create', {
				kind: 'root',
				name: 'user',
			} ),
			loadViewConfig( 'root', 'user' ),
			preloadFieldCollections( 'root', 'user' ),
		] );
	},
};
