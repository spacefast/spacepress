import { select } from '@wordpress/data';
import { store as firstAdminStore } from '@first-admin/boot';
import { redirect } from '@wordpress/route';

export const route = {
	// Redirect before the dashboard mounts if a plugin set an override route
	// via the PHP filter `first_admin_dashboard_context`.
	// See: [upstream private reference omitted]
	beforeLoad: () => {
		const context = select( firstAdminStore ).getDashboardContext();

		if ( context?.overrideRoute && context.overrideRoute !== '/' ) {
			throw redirect( { to: context.overrideRoute } );
		}
	},
};
