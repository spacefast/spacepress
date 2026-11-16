import { useViewConfig } from '@typedpress-admin/views';
import { useTrackedModal } from '@typedpress-admin/telemetry';
import type { Action, RenderModalProps } from '@typedpress-admin/dataviews';
import type { User } from '@wordpress/core-data';
import { store as coreStore } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { useCallback, useEffect, useMemo, useRef } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { trash } from '@wordpress/icons';
import { DeleteUserModalContent } from '../../user/components/delete-user-modal';
import { isStoreOwner } from '../../user/utils';

const DeleteUsersModalWrapper = ( {
	items,
	closeModal,
	onActionPerformed,
}: RenderModalProps< User > ) => {
	const modal = useTrackedModal( 'delete_user' );
	const handledCloseRef = useRef( false );

	const closeFromContent = useCallback( () => {
		handledCloseRef.current = true;
		closeModal?.();
	}, [ closeModal ] );

	useEffect(
		() => () => {
			if ( ! handledCloseRef.current ) {
				modal.trackClose( 'unknown' );
			}
		},
		[ modal ]
	);

	return (
		<DeleteUserModalContent
			users={ items }
			modal={ modal }
			onClose={ closeFromContent }
			onSuccess={ () => {
				if ( onActionPerformed ) {
					onActionPerformed( items );
				}
			} }
		/>
	);
};

export const useDeleteUserAction = (): Action< User > | null => {
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
	const isEnabled = Array.isArray( actions ) && actions.includes( 'delete' );

	return useMemo( () => {
		// Don't show if disabled
		if ( ! isEnabled ) {
			return null;
		}

		return {
			id: 'delete-user',
			label: __( 'Delete', 'typedpress-admin' ),
			isDestructive: true,
			isPrimary: false,
			icon: trash,
			supportsBulk: true,
			modalHeader: ( items: User[] ) =>
				items.length === 1
					? __( 'Delete user?', 'typedpress-admin' )
					: __( 'Delete users?', 'typedpress-admin' ),
			RenderModal: DeleteUsersModalWrapper,
			isEligible: ( item: User ) => {
				// Cannot delete yourself, the store owner, or without proper permissions
				return (
					item.id !== currentUser.id &&
					! isStoreOwner( item ) &&
					Boolean( canCreateUsers )
				);
			},
		};
	}, [ currentUser, canCreateUsers, isEnabled ] );
};
