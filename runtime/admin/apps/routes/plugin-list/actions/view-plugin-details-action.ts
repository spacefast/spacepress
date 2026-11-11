import { __ } from '@wordpress/i18n';
import { info } from '@wordpress/icons';
import type { Plugin } from '@wordpress/core-data';
import type { Action } from '@first-admin/dataviews';
import { useNavigate, useSearch } from '@wordpress/route';

export const useViewPluginDetailsAction = (): Action< Plugin > => {
	const navigate = useNavigate();
	const searchParams = useSearch( { from: '/plugins/list/$slug' } );

	return {
		id: 'view-plugin-details',
		label: __( 'View Details', 'first-admin' ),
		isPrimary: false,
		icon: info,
		callback: ( items: Plugin[] ) => {
			if ( items.length > 0 ) {
				const item = items[ 0 ];
				const slug = item.plugin.split( '/' )[ 0 ];
				navigate( {
					search: {
						...searchParams,
						selectedPlugin: slug,
						details: 1,
					},
				} );
			}
		},
		isEligible: () => true,
	};
};
