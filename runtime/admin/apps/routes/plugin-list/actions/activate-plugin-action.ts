import type { Plugin } from '@wordpress/core-data';
import { __, _n, sprintf } from '@wordpress/i18n';
import { plugins as pluginsIcon } from '@wordpress/icons';
import type { Action } from '@typedpress-admin/dataviews';
import usePluginService from '../hooks/use-plugin-service';
import { bulkAction } from './helpers/bulk-runner';

export const useActivatePluginAction = (): Action< Plugin > => {
	const { editPlugin, canUser } = usePluginService();

	const isEligibleForActivate = ( plugin: Plugin ) =>
		canUser( 'update', plugin ) &&
		plugin.status === 'inactive' &&
		! plugin.network_only;

	return {
		id: 'activate-plugin',
		label: __( 'Activate', 'typedpress-admin' ),
		isPrimary: true,
		icon: pluginsIcon,
		callback: async ( plugins: Plugin[] ) => {
			const eligible = plugins.filter( isEligibleForActivate );
			await bulkAction(
				eligible,
				( plugin ) =>
					editPlugin( plugin, [ 'status' ], 'active', {
						suppressNotice: eligible.length > 1,
					} ),
				{
					buildMessage: ( fulfilled, rejected ) => {
						let message = '';

						if ( fulfilled > 0 ) {
							message += sprintf(
								// translators: %d is the number of plugins activated.
								_n(
									'%d plugin activated.',
									'%d plugins activated.',
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
								// translators: %d is the number of plugins that failed to activate.
								_n(
									'%d plugin failed to activate.',
									'%d plugins failed to activate.',
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
		isEligible: isEligibleForActivate,
		supportsBulk: true,
	};
};
