import type { Plugin } from '@wordpress/core-data';
import { __, _n, sprintf } from '@wordpress/i18n';
import { linkOff } from '@wordpress/icons';
import type { Action } from '@typedpress-admin/dataviews';
import usePluginService from '../hooks/use-plugin-service';
import { bulkAction } from './helpers/bulk-runner';

export const useDisableAutoUpdatesPluginAction = (): Action< Plugin > => {
	const { editPlugin, canUser } = usePluginService();

	const isEligibleForDisable = ( plugin: Plugin ) =>
		canUser( 'update', plugin ) &&
		! plugin.network_only &&
		plugin.auto_update;

	return {
		id: 'disable-auto-updates-plugin',
		label: __( 'Disable auto-updates', 'typedpress-admin' ),
		isPrimary: false,
		icon: linkOff,
		callback: async ( plugins: Plugin[] ) => {
			const eligible = plugins.filter( isEligibleForDisable );
			await bulkAction(
				eligible,
				( plugin ) =>
					editPlugin( plugin, [ 'auto_update' ], false, {
						suppressNotice: eligible.length > 1,
					} ),
				{
					buildMessage: ( fulfilled, rejected ) => {
						let message = '';

						if ( fulfilled > 0 ) {
							message += sprintf(
								// translators: %d is the number of plugins disabled.
								_n(
									'Disabled auto-updates on %d plugin.',
									'Disabled auto-updates on %d plugins.',
									fulfilled,
									'typedpress-admin'
								),
								fulfilled
							);
						}

						if ( rejected > 0 ) {
							if ( fulfilled > 0 ) {
								message += ' ';
							}
							message += sprintf(
								// translators: %d is the number of plugins that failed to disable auto-updates.
								_n(
									'%d plugin failed to disable auto-updates.',
									'%d plugins failed to disable auto-updates.',
									rejected,
									'typedpress-admin'
								),
								rejected
							);
						}

						return message;
					},
				}
			);
		},
		isEligible: isEligibleForDisable,
		supportsBulk: true,
	};
};
