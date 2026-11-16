import { useDispatch, useSelect } from '@wordpress/data';
import type { Plugin } from '@wordpress/core-data';
import {
	store as coreStore,
	store as coreDataStore,
} from '@wordpress/core-data';
import { store as noticesStore } from '@wordpress/notices';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback } from '@wordpress/element';
import { setImmutably } from '../../design-styles/global-styles-ui/font-library-modal/utils/set-immutably';
import {
	resolvePluginAction,
	PluginAction,
} from '../actions/helpers/plugin-action-resolver';

const noticeConfig = {
	type: 'snackbar' as const,
	id: 'plugin-service-notice',
};

const getErrorText = ( error: unknown ) =>
	error &&
	typeof error === 'object' &&
	'message' in error &&
	typeof error.message === 'string'
		? error.message
		: __( 'Unknown error occurred', 'zero-admin' );

export default function usePluginService() {
	const { saveEntityRecord, deleteEntityRecord } =
		useDispatch( coreDataStore );
	const { createSuccessNotice, createErrorNotice } =
		useDispatch( noticesStore );

	const canUserSelect = useSelect(
		( select ) => select( coreStore ).canUser,
		[]
	);

	const canUser = ( action: string, plugin: Plugin ) =>
		Boolean(
			canUserSelect( action, {
				kind: 'root',
				name: 'plugin',
				id: plugin.plugin,
			} )
		);

	const deletePlugin = useCallback(
		async ( plugin: Plugin, opts?: { suppressNotice?: boolean } ) => {
			try {
				await deleteEntityRecord(
					'root',
					'plugin',
					plugin.plugin,
					{},
					{ throwOnError: true }
				);

				if ( ! opts?.suppressNotice ) {
					const successMessage = sprintf(
						// translators: %(name)s is the plugin name.
						__( '%(name)s deleted.', 'zero-admin' ),
						{ name: plugin.name }
					);
					createSuccessNotice( successMessage, noticeConfig );
				}
			} catch ( error ) {
				if ( opts?.suppressNotice ) {
					throw error;
				}
				const errorMessage = sprintf(
					// translators: %(p)s is the plugin name, %(m)s is the error message from the API.
					__( 'Failed to delete %(p)s: %(m)s', 'zero-admin' ),
					{
						p: plugin.name,
						m: getErrorText( error ),
					}
				);
				createErrorNotice( errorMessage, noticeConfig );
			}
		},
		[ deleteEntityRecord, createSuccessNotice, createErrorNotice ]
	);

	const editPlugin = useCallback(
		async (
			plugin: Plugin,
			path: string[],
			value: unknown,
			opts?: { suppressNotice?: boolean }
		) => {
			const record = setImmutably( plugin, path, value );

			// eslint-disable-next-line @wordpress/no-unused-vars-before-return
			const action = resolvePluginAction( path, value );
			try {
				await saveEntityRecord( 'root', 'plugin', record, {
					throwOnError: true,
				} );

				if ( opts?.suppressNotice ) {
					return;
				}
				let successMessage: string;
				switch ( action ) {
					case PluginAction.Activate:
						successMessage = sprintf(
							// translators: %(p)s is the plugin name.
							__( '%(p)s activated.', 'zero-admin' ),
							{ p: plugin.name }
						);
						break;
					case PluginAction.Deactivate:
						successMessage = sprintf(
							// translators: %(p)s is the plugin name.
							__( '%(p)s deactivated.', 'zero-admin' ),
							{ p: plugin.name }
						);
						break;
					case PluginAction.AutoUpdatesEnabled:
						successMessage = sprintf(
							// translators: %(p)s is the plugin name.
							__(
								'Auto-updates enabled on %(p)s.',
								'zero-admin'
							),
							{ p: plugin.name }
						);
						break;
					case PluginAction.AutoUpdatesDisabled:
						successMessage = sprintf(
							// translators: %(p)s is the plugin name.
							__(
								'Auto-updates disabled on %(p)s.',
								'zero-admin'
							),
							{ p: plugin.name }
						);
						break;
					case PluginAction.Updated:
					default:
						successMessage = sprintf(
							// translators: %(p)s is the plugin name.
							__( '%(p)s updated.', 'zero-admin' ),
							{ p: plugin.name }
						);
				}
				createSuccessNotice( successMessage, noticeConfig );
			} catch ( error ) {
				if ( opts?.suppressNotice ) {
					throw error;
				}
				let errorMessage: string;
				const errorText = getErrorText( error );
				switch ( action ) {
					case PluginAction.Activate:
						errorMessage = sprintf(
							// translators: %(p)s is the plugin name, %(m)s is the error message from the API.
							__(
								'Failed to activate %(p)s: %(m)s',
								'zero-admin'
							),
							{ p: plugin.name, m: errorText }
						);
						break;
					case PluginAction.Deactivate:
						errorMessage = sprintf(
							// translators: %(p)s is the plugin name, %(m)s is the error message from the API.
							__(
								'Failed to deactivate %(p)s: %(m)s',
								'zero-admin'
							),
							{ p: plugin.name, m: errorText }
						);
						break;
					case PluginAction.AutoUpdatesEnabled:
						errorMessage = sprintf(
							// translators: %(p)s is the plugin name, %(m)s is the error message from the API.
							__(
								'Failed to enable auto-updates on %(p)s: %(m)s',
								'zero-admin'
							),
							{ p: plugin.name, m: errorText }
						);
						break;
					case PluginAction.AutoUpdatesDisabled:
						errorMessage = sprintf(
							// translators: %(p)s is the plugin name, %(m)s is the error message from the API.
							__(
								'Failed to disable auto-updates on %(p)s: %(m)s',
								'zero-admin'
							),
							{ p: plugin.name, m: errorText }
						);
						break;
					case PluginAction.Updated:
					default:
						errorMessage = sprintf(
							// translators: %(p)s is the plugin name, %(m)s is the error message from the API.
							__( 'Failed to update %(p)s: %(m)s', 'zero-admin' ),
							{ p: plugin.name, m: errorText }
						);
				}
				createErrorNotice( errorMessage, noticeConfig );
			}
		},
		[ saveEntityRecord, createSuccessNotice, createErrorNotice ]
	);

	const updatePluginVersion = useCallback(
		async ( plugin: Plugin, opts?: { suppressNotice?: boolean } ) => {
			try {
				await saveEntityRecord(
					'root',
					'plugin',
					{ plugin: plugin.plugin, update: true },
					{ throwOnError: true }
				);

				if ( ! opts?.suppressNotice ) {
					const successMessage = sprintf(
						// translators: %(name)s is the plugin name.
						__(
							'%(name)s updated to the latest version.',
							'zero-admin'
						),
						{ name: plugin.name }
					);

					createSuccessNotice( successMessage, noticeConfig );
				}
			} catch ( error ) {
				if ( opts?.suppressNotice ) {
					throw error;
				}
				createErrorNotice(
					sprintf(
						// translators: %(p)s is the plugin name, %(m)s is the error message from the API.
						__( 'Failed to update %(p)s: %(m)s', 'zero-admin' ),
						{
							p: plugin.name,
							m: getErrorText( error ),
						}
					),
					noticeConfig
				);
			}
		},
		[ saveEntityRecord, createSuccessNotice, createErrorNotice ]
	);

	return {
		canUser,
		deletePlugin,
		editPlugin,
		updatePluginVersion,
	};
}
