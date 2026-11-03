import type { Plugin } from '@wordpress/core-data';
import { __, _n, sprintf } from '@wordpress/i18n';
import { backup } from '@wordpress/icons';
import type { Action } from '@zero-admin/dataviews';
import usePluginService from '../hooks/use-plugin-service';
import { bulkAction } from './helpers/bulk-runner';

export const useEnableAutoUpdatesPluginAction = (): Action< Plugin > => {
	const { editPlugin, canUser } = usePluginService();

	const isEligibleForEnable = ( plugin: Plugin ) =>
		canUser( 'update', plugin ) &&
		! plugin.network_only &&
		! plugin.auto_update;

	return {
		id: 'enable-auto-updates-plugin',
		label: __( 'Enable auto-updates', 'zero-admin' ),
		isPrimary: false,
		icon: backup,
		callback: async ( plugins: Plugin[] ) => {
			const eligible = plugins.filter( isEligibleForEnable );
			await bulkAction(
				eligible,
				( plugin ) =>
					editPlugin( plugin, [ 'auto_update' ], true, {
						suppressNotice: eligible.length > 1,
					} ),
				{
					buildMessage: ( fulfilled, rejected ) => {
						let message = '';

						if ( fulfilled > 0 ) {
							message += sprintf(
								// translators: %d is the number of plugins enabled.
								_n(
									'Enabled auto-updates on %d plugin.',
									'Enabled auto-updates on %d plugins.',
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
								// translators: %d is the number of plugins that failed to enable auto-updates.
								_n(
									'%d plugin failed to enable auto-updates.',
									'%d plugins failed to enable auto-updates.',
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
		isEligible: isEligibleForEnable,
		supportsBulk: true,
	};
};
