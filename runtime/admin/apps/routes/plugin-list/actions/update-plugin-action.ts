import type { Plugin } from '@wordpress/core-data';
import { __, _n, sprintf } from '@wordpress/i18n';
import { update } from '@wordpress/icons';
import type { Action } from '@first-admin/dataviews';
import usePluginService from '../hooks/use-plugin-service';
import { bulkAction } from './helpers/bulk-runner';

export const useUpdatePluginAction = (): Action< Plugin > => {
	const { updatePluginVersion, canUser } = usePluginService();

	const isEligibleForUpdate = ( plugin: Plugin ) =>
		canUser( 'update', plugin ) &&
		plugin.update_available &&
		! plugin.network_only;

	return {
		id: 'update-plugin',
		label: __( 'Update', 'first-admin' ),
		isPrimary: false,
		icon: update,
		callback: async ( plugins: Plugin[] ) => {
			const eligible = plugins.filter( isEligibleForUpdate );
			await bulkAction(
				eligible,
				( plugin ) =>
					updatePluginVersion( plugin, {
						suppressNotice: eligible.length > 1,
					} ),
				{
					buildMessage: ( fulfilled, rejected ) => {
						let message = '';

						if ( fulfilled > 0 ) {
							message += sprintf(
								// translators: %d is the number of plugins updated.
								_n(
									'%d plugin updated.',
									'%d plugins updated.',
									fulfilled,
									'first-admin'
								),
								fulfilled
							);
						}

						if ( rejected > 0 ) {
							if ( fulfilled > 0 ) {
								message += ' ';
							}
							message += sprintf(
								// translators: %d is the number of plugins that failed to update.
								_n(
									'%d plugin failed to update.',
									'%d plugins failed to update.',
									rejected,
									'first-admin'
								),
								rejected
							);
						}

						return message;
					},
				}
			);
		},
		isEligible: isEligibleForUpdate,
		supportsBulk: true,
	};
};
