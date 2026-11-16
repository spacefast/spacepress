import { redirect } from '@wordpress/route';

export const route = {
	beforeLoad: ( { params }: { params: { type: string } } ) => {
		throw redirect( {
			to: '/types/$type/list/$slug',
			params: {
				type: params.type,
				slug: 'all',
			},
		} );
	},
};
