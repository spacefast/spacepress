import { useViewConfig } from '@first-admin/views';
import type { Action, RenderModalProps } from '@first-admin/dataviews';
import type { User } from '@wordpress/core-data';
import { store as coreStore } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { useMemo, useState, useCallback } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { people } from '@wordpress/icons';
import { store as noticesStore } from '@wordpress/notices';
import {
	__experimentalHStack as HStack,
	__experimentalText as Text,
	__experimentalVStack as VStack,
	__experimentalSpacer as Spacer,
	Button,
	// Popovers cannot be used in an DataViews actions modal.
	// https://github.com/WordPress/gutenberg/issues/71463
	// eslint-disable-next-line @first-admin/design-system/use-new-components
	SelectControl,
} from '@wordpress/components';
import { CurrentUserWarning } from '../current-user-warning';

const UpdateUserRoleModal = ( {
	items,
	closeModal,
	onActionPerformed,
}: RenderModalProps< User > ) => {
	const [ isBusy, setIsBusy ] = useState( false );
	const [ selectedRole, setSelectedRole ] = useState( '' );

	const { createSuccessNotice, createErrorNotice } =
		useDispatch( noticesStore );
	const dispatch = useDispatch( coreStore );
	const coreSelect = useSelect( coreStore, [] );

	const handleConfirmUpdate = useCallback( async () => {
		setIsBusy( true );
		const updates = items.map(
			( item ) =>
				( { saveEntityRecord }: typeof dispatch ) =>
					saveEntityRecord(
						'root',
						`user`,
						{
							id: item.id,
							roles: [ selectedRole ],
						},
						{ throwOnError: true }
					)
		);
		try {
			await dispatch.__experimentalBatch( updates );
			const successMessage =
				items.length === 1
					? __( 'User updated.', 'first-admin' )
					: sprintf(
							/* translators: %d: The number of users. */
							_n(
								'%d user updated.',
								'%d users updated.',
								items.length,
								'first-admin'
							),
							items.length
					  );

			await createSuccessNotice( successMessage, {
				type: 'snackbar',
				id: 'update-user-success-notice',
			} );
		} catch {
			const errors = items.map( ( item ) =>
				coreSelect.getLastEntitySaveError( 'root', 'user', item.id )
			);
			const errorMessages = errors
				.map( ( error ) => error.message )
				.join( '\n' );

			const errorMessage =
				errors.length === 1
					? sprintf(
							/* translators: %s: an error message */
							__(
								'An error occurred while updating user: %s',
								'first-admin'
							),
							errorMessages
					  )
					: sprintf(
							/* translators: %s: an error message */
							__(
								'Some errors occurred while updating the users: %s',
								'first-admin'
							),
							errorMessages
					  );
			await createErrorNotice( errorMessage, {
				type: 'snackbar',
			} );
		}

		// If all the promises were fulfilled with success.
		if ( onActionPerformed ) {
			onActionPerformed( items );
		}
		setIsBusy( false );
		closeModal?.();
	}, [
		items,
		selectedRole,
		closeModal,
		createErrorNotice,
		createSuccessNotice,
		onActionPerformed,
		dispatch,
		coreSelect,
	] );

	return (
		<VStack>
			<Text>
				{ __( 'You have specified these users:', 'first-admin' ) }
			</Text>
			{ items.map( ( user ) => (
				<Text key={ user.id }>
					{ sprintf(
						// Translators: %1$d is the user ID, %2$s is the username.
						__( 'ID #%1$d: %2$s', 'first-admin' ),
						user.id,
						user.username
					) }
				</Text>
			) ) }
			<CurrentUserWarning actionType="update-role" />
			<Spacer />
			<SelectControl
				__nextHasNoMarginBottom
				__next40pxDefaultSize
				label={ __( 'Select a role:', 'first-admin' ) }
				options={ [
					{
						value: '',
						label: __( '— Select —', 'first-admin' ),
					},
					{
						value: 'administrator',
						label: __( 'Administrator', 'first-admin' ),
					},
					{
						value: 'editor',
						label: __( 'Editor', 'first-admin' ),
					},
					{
						value: 'author',
						label: __( 'Author', 'first-admin' ),
					},
					{
						value: 'contributor',
						label: __( 'Contributor', 'first-admin' ),
					},
					{
						value: 'subscriber',
						label: __( 'Subscriber', 'first-admin' ),
					},
				] }
				onChange={ setSelectedRole }
				value=""
			/>
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
					onClick={ handleConfirmUpdate }
					isBusy={ isBusy }
					disabled={ isBusy || ! selectedRole }
					accessibleWhenDisabled
				>
					{ __( 'Confirm Update', 'first-admin' ) }
				</Button>
			</HStack>
		</VStack>
	);
};

export const useUpdateUserRoleAction = (): Action< User > | null => {
	const { currentUser, canCreateUsers } = useSelect( ( select ) => {
		const { getCurrentUser, canUser } = select( coreStore );
		return {
			currentUser: getCurrentUser(),
			canCreateUsers: canUser( 'create', {
				kind: 'root',
				name: 'user',
			} ),
		};
	}, [] );

	const { actions } = useViewConfig( 'root', 'user' );
	const isEnabled =
		Array.isArray( actions ) && actions.includes( 'update_role' );

	return useMemo( () => {
		// Don't show if disabled
		if ( ! isEnabled ) {
			return null;
		}

		return {
			id: 'update-user-role',
			label: __( 'Update Role', 'first-admin' ),
			icon: people,
			supportsBulk: true,
			hideModalHeader: true,
			modalFocusOnMount: 'firstContentElement',
			RenderModal: UpdateUserRoleModal,
			isEligible: ( item: User ) => {
				return item.id !== currentUser.id && Boolean( canCreateUsers );
			},
		};
	}, [ currentUser, canCreateUsers, isEnabled ] );
};
