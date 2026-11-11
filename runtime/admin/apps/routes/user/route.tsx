import { redirect } from '@wordpress/route';
import { preloadFieldCollections } from '@first-admin/core-data-next';
export const route = {
	beforeLoad: () => {
		throw redirect( {
			to: '/users/list/$slug',
			params: {
				slug: 'all',
			},
		} );
	},
	loader: async () => {
		await preloadFieldCollections( 'root', 'user' );
	},
};
