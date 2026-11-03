import { redirect } from '@wordpress/route';

export const route = {
	beforeLoad: ( { params }: { params: { type: string } } ) => {
		// This route does the same thing as routes/post/route.tsx.
		// I wasn't able to have the same route handle two different paths.
		// So as a workaround, I created this duplicate route file for now.
		throw redirect( {
			to: '/types/$type/list/$slug',
			params: {
				type: params.type,
				slug: 'all',
			},
		} );
	},
};
