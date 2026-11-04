import type { Plugin } from '@wordpress/core-data';
import { __, _n, sprintf } from '@wordpress/i18n';
import { cancelCircleFilled } from '@wordpress/icons';
import type { Action } from '@zero-admin/dataviews';
import usePluginService from '../hooks/use-plugin-service';
import { bulkAction } from './helpers/bulk-runner';

export const useDeactivatePluginAction = (): Action< Plugin > => {
	const { editPlugin, canUser } = usePluginService();

	const isEligibleForDeactivate = ( plugin: Plugin ) =>
		canUser( 'update', plugin ) &&
		plugin.status === 'active' &&
		! plugin.network_only;

	return {
		id: 'deactivate-plugin',
		label: __( 'Deactivate', 'zero-admin' ),
		isPrimary: true,
		icon: cancelCircleFilled,
		callback: async ( plugins: Plugin[] ) => {
			const eligible = plugins.filter( isEligibleForDeactivate );
			await bulkAction(
				eligible,
				( plugin ) =>
					editPlugin( plugin, [ 'status' ], 'inactive', {
						suppressNotice: eligible.length > 1,
					} ),
				{
					buildMessage: ( fulfilled, rejected ) => {
						let message = '';

						if ( fulfilled > 0 ) {
							message += sprintf(
								// translators: %d is the number of plugins deactivated.
								_n(
									'%d plugin deactivated.',
									'%d plugins deactivated.',
									fulfilled,
									'zero-admin'
								),
								fulfilled
							);
						}

						if ( rejected > 0 ) {
							if ( fulfilled > 0 ) {
								message += ' ';
							}
							message += sprintf(
								// translators: %d is the number of plugins that failed to deactivate.
								_n(
									'%d plugin failed to deactivate.',
									'%d plugins failed to deactivate.',
									rejected,
									'zero-admin'
								),
								rejected
							);
						}

						return message;
					},
				}
			);
		},
		isEligible: isEligibleForDeactivate,
		supportsBulk: true,
	};
};
