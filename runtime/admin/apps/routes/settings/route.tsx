import { redirect } from '@wordpress/route';

export const route = {
	beforeLoad: () => {
		throw redirect( { to: '/settings/general' } );
	},
};
