import type { Plugin } from '@wordpress/core-data';
import { __, _n, sprintf } from '@wordpress/i18n';
import { trash } from '@wordpress/icons';
import {
	__experimentalHStack as HStack,
	__experimentalText as Text,
	__experimentalVStack as VStack,
	Button,
} from '@wordpress/components';
import { useState } from '@wordpress/element';
import { decodeEntities } from '@wordpress/html-entities';
import type { Action, RenderModalProps } from '@first-admin/dataviews';
import usePluginService from '../hooks/use-plugin-service';
import { bulkAction } from './helpers/bulk-runner';

// @TODO: Generalize this modal to be used for other delete actions as well, and possibly other actions that require confirmation.
const DeletePluginModal = ( {
	items,
	closeModal,
}: RenderModalProps< Plugin > ) => {
	const { deletePlugin: deletePluginService, canUser } = usePluginService();
	const [ isBusy, setIsBusy ] = useState( false );

	// Prefer a count-aware confirmation and bulk delete handling.
	const count = items.length;
	const single = count === 1;
	const [ first ] = items;
	const name = decodeEntities( first?.name );

	const isEligibleForDelete = ( plugin: Plugin ) =>
		canUser( 'delete', plugin ) &&
		plugin.status === 'inactive' &&
		! plugin.network_only;

	const handleDeletePlugin = async () => {
		setIsBusy( true );
		try {
			const eligible = items.filter( isEligibleForDelete );
			await bulkAction(
				eligible,
				( p ) =>
					deletePluginService( p, {
						suppressNotice: eligible.length > 1,
					} ),
				{
					buildMessage: ( fulfilled, rejected ) => {
						let message = '';

						if ( fulfilled > 0 ) {
							message += sprintf(
								// translators: %d is the number of plugins deleted.
								_n(
									'%d plugin deleted.',
									'%d plugins deleted.',
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
								// translators: %d is the number of plugins that failed to delete.
								_n(
									'%d plugin failed to delete.',
									'%d plugins failed to delete.',
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
		} finally {
			setIsBusy( false );
			closeModal?.();
		}
	};

	return (
		<VStack spacing={ 4 }>
			<Text>
				{ single
					? sprintf(
							// translators: %(name)s is the plugin name.
							__(
								'Are you sure you want to delete %(name)s?',
								'first-admin'
							),
							{ name }
					  )
					: sprintf(
							// translators: %d is the number of selected plugins
							_n(
								'Are you sure you want to delete %d plugin?',
								'Are you sure you want to delete %d plugins?',
								count,
								'first-admin'
							),
							count
					  ) }
			</Text>
			{ ! single && (
				<VStack spacing={ 2 }>
					<ul style={ { margin: 0, paddingInlineStart: '20px' } }>
						{ items.map( ( p ) => (
							<li key={ p.plugin }>
								{ decodeEntities( p.name ) }
							</li>
						) ) }
					</ul>
				</VStack>
			) }
			<HStack justify="right">
				<Button
					__next40pxDefaultSize
					variant="tertiary"
					onClick={ closeModal }
					disabled={ isBusy }
					accessibleWhenDisabled
				>
					{ __( 'Cancel', 'first-admin' ) }
				</Button>
				<Button
					__next40pxDefaultSize
					variant="primary"
					onClick={ handleDeletePlugin }
					isBusy={ isBusy }
					disabled={ isBusy }
					accessibleWhenDisabled
				>
					{ __( 'Delete', 'first-admin' ) }
				</Button>
			</HStack>
		</VStack>
	);
};

export const useDeletePluginAction = (): Action< Plugin > => {
	const { canUser } = usePluginService();

	return {
		id: 'delete-plugin',
		label: __( 'Delete', 'first-admin' ),
		RenderModal: DeletePluginModal,
		isEligible: ( plugin: Plugin ) =>
			canUser( 'delete', plugin ) &&
			plugin.status === 'inactive' &&
			! plugin.network_only,
		supportsBulk: true,
		icon: trash,
	};
};
