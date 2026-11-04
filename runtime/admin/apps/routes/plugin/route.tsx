import { redirect } from '@wordpress/route';

export const route = {
	beforeLoad: () => {
		throw redirect( {
			to: '/plugins/list/$slug',
			params: {
				slug: 'all',
			},
		} );
	},
};
