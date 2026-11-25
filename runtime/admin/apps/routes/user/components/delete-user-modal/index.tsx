import { __, sprintf } from '@wordpress/i18n';
import { useSelect } from '@wordpress/data';
import { store as coreStore, type User } from '@wordpress/core-data';
import {
	Modal,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalText as Text,
	Button,
} from '@wordpress/components';
import { useTrackedModal } from '@spacepress-admin/telemetry';
import type { ExtendedUser } from '../../types';
import { useDeleteUser } from '../../hooks';
import { getUserDisplayName } from '../../utils';

// TODO: Import TrackedModal from @spacepress-admin/telemetry once the type is exported.
// Currently not possible because the WP Module loses type resolution in strict mode.
// Source: ciab-next/packages/telemetry/src/hooks/use-tracked-modal.ts
interface ModalTracking {
	trackButtonClick: ( label: string ) => void;
}

interface DeleteUserModalContentProps {
	users: User[];
	modal: ModalTracking;
	onClose?: () => void;
	onSuccess?: () => void;
}

interface DeleteUserModalProps {
	users: User[];
	isOpen: boolean;
	onClose?: () => void;
	onSuccess?: () => void;
}

function DeleteUserModalContent( {
	users,
	modal,
	onClose,
	onSuccess,
}: DeleteUserModalContentProps ) {
	const storeOwner = useSelect( ( select ) => {
		return select( coreStore ).getUser( 1 );
	}, [] );

	const { deleteUsers, isBusy } = useDeleteUser( {
		excludeUserIds: users.map( ( u ) => u.id ),
		onSuccess: () => {
			if ( onClose ) {
				onClose();
			}
			if ( onSuccess ) {
				onSuccess();
			}
		},
		onError: () => {
			// Close the modal on error as well
			if ( onClose ) {
				onClose();
			}
		},
	} );

	const isSingleUser = users.length === 1;
	const hasUsersWithContent = users.some(
		( u ) => ( ( u as ExtendedUser ).post_count ?? 0 ) > 0
	);
	const storeOwnerName = storeOwner
		? getUserDisplayName( storeOwner )
		: __( 'the store owner', 'spacepress-admin' );

	const handleConfirm = () => {
		modal.trackButtonClick( 'delete_permanently' );
		void deleteUsers( users );
	};

	return (
		<VStack>
			<Text>
				{ isSingleUser
					? sprintf(
							/* translators: %s: user name or email */
							__(
								"%s will be permanently deleted and can't be restored.",
								'spacepress-admin'
							),
							getUserDisplayName( users[ 0 ] )
					  )
					: sprintf(
							/* translators: %d: number of users */
							__(
								"%d users will be permanently deleted and can't be restored.",
								'spacepress-admin'
							),
							users.length
					  ) }
			</Text>
			{ hasUsersWithContent && (
				<Text style={ { marginTop: '10px' } }>
					{ isSingleUser
						? sprintf(
								/* translators: 1: user name or email, 2: store owner name or email */
								__(
									'The content owned by %1$s will be attributed to the store owner, %2$s.',
									'spacepress-admin'
								),
								getUserDisplayName( users[ 0 ] ),
								storeOwnerName
						  )
						: sprintf(
								/* translators: %s: store owner name or email */
								__(
									'The content owned by these users will be attributed to the store owner, %s.',
									'spacepress-admin'
								),
								storeOwnerName
						  ) }
				</Text>
			) }
			<HStack justify="right" style={ { marginTop: '24px' } }>
				<Button
					__next40pxDefaultSize
					variant="tertiary"
					onClick={ () => {
						modal.trackButtonClick( 'cancel' );
						if ( onClose ) {
							onClose();
						}
					} }
					disabled={ isBusy }
					accessibleWhenDisabled
				>
					{ __( 'Cancel', 'spacepress-admin' ) }
				</Button>
				<Button
					__next40pxDefaultSize
					variant="primary"
					isDestructive
					onClick={ handleConfirm }
					isBusy={ isBusy }
					disabled={ isBusy }
					accessibleWhenDisabled
				>
					{ __( 'Delete permanently', 'spacepress-admin' ) }
				</Button>
			</HStack>
		</VStack>
	);
}

export function DeleteUserModal( {
	users,
	isOpen,
	onClose,
	onSuccess,
}: DeleteUserModalProps ) {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- useTrackedModal is a WP Module that loses type resolution in strict mode
	const modal = useTrackedModal( 'delete_user', { isOpen } );

	if ( ! isOpen ) {
		return null;
	}

	return (
		<Modal
			onRequestClose={ ( event ) => {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- WP Module loses type info
				modal.trackRequestClose( event );
				if ( onClose ) {
					onClose();
				}
			} }
			size="medium"
			className="delete-user-modal"
			title={
				users.length === 1
					? __( 'Delete user?', 'spacepress-admin' )
					: __( 'Delete users?', 'spacepress-admin' )
			}
		>
			<DeleteUserModalContent
				users={ users }
				modal={ modal }
				onClose={ onClose }
				onSuccess={ onSuccess }
			/>
		</Modal>
	);
}

export { DeleteUserModalContent };
