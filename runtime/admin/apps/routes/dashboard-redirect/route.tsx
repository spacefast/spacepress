import { redirect } from '@wordpress/route';

/** TypedPress: the dashboard was at `/dashboard` before it became the home route again; keep those links. */
export const route = {
	beforeLoad: () => {
		throw redirect( { to: '/' } );
	},
};
