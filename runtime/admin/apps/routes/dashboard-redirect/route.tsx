import { redirect } from '@wordpress/route';

/** First: the dashboard was at `/dashboard` before it became the home route again; keep those links. */
export const route = {
	beforeLoad: () => {
		throw redirect( { to: '/' } );
	},
};
