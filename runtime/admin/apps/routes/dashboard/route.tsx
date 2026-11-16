import { select } from '@wordpress/data';
import { store as tpAdminStore } from '@typedpress-admin/boot';
import { redirect } from '@wordpress/route';

export const route = {
	// Redirect before the dashboard mounts if a plugin set an override route
	// via the PHP filter `tp_admin_dashboard_context`.
	// See: [upstream private reference omitted]
	beforeLoad: () => {
		const context = select( tpAdminStore ).getDashboardContext();

		if ( context?.overrideRoute && context.overrideRoute !== '/' ) {
			throw redirect( { to: context.overrideRoute } );
		}
	},
};
