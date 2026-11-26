import { Icon } from '@wordpress/ui';
import { store as userDataStore } from '@spacepress-admin/user-data';
import { __, sprintf } from '@wordpress/i18n';
import { select, useDispatch, useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { useCallback, useState, createElement } from '@wordpress/element';
import type { User } from '@wordpress/core-data';
import { store as noticesStore } from '@wordpress/notices';
import { check, close } from '@wordpress/icons';
import { getUserDisplayName } from '../utils';
import type { ExtendedUser } from '../types';

interface AddUserFormCallbacks {
	onSuccess?: () => void;
	onError?: ( error: unknown ) => void;
}

interface AddUserFormProps {
	data: Partial< User >;
	isDirty: boolean;
	isSaving: boolean;
	errorMessage: string | undefined;
	isSuccess: boolean;
	saveButtonLabel: string;
	handleOnChange: ( value: Partial< ExtendedUser > ) => void;
	handleSubmit: () => Promise< void >;
}

export function useAddUserForm(
	isInviteMode: boolean = false,
	callbacks?: AddUserFormCallbacks
): AddUserFormProps {
	const [ data, setData ] = useState< Partial< ExtendedUser > >( {
		roles: [ 'administrator' ],
	} );
	const [ isDirty, setIsDirty ] = useState< boolean >( false );
	const [ localErrorMessage, setLocalErrorMessage ] = useState<
		string | undefined
	>();
	const [ isSuccess, setIsSuccess ] = useState< boolean >( false );
	const [ localIsSaving, setLocalIsSaving ] = useState< boolean >( false );
	const { createSuccessNotice, removeNotice } = useDispatch( noticesStore );
	const { createInvite, resetCreateInviteState } =
		useDispatch( userDataStore );
	const coreDispatch = useDispatch( coreStore );

	// Read invite operation state from the store.
	// TODO: The callback select() doesn't resolve user-data selectors due to
	// a @wordpress/data version mismatch between packages, so we use the
	// module-level select(). Remove when versions are aligned.
	const { storeIsCreating, storeCreateError } = useSelect( () => {
		if ( ! isInviteMode ) {
			return {
				storeIsCreating: false,
				storeCreateError: null as string | null,
			};
		}
		return {
			storeIsCreating: select( userDataStore ).isCreatingInvite(),
			storeCreateError: select( userDataStore ).getCreateInviteError(),
		};
	}, [ isInviteMode ] );

	// In invite mode derive from store; in regular mode use local state
	const isSaving = isInviteMode ? storeIsCreating : localIsSaving;
	const errorMessage = isInviteMode
		? storeCreateError ?? undefined
		: localErrorMessage;

	// Determine button labels based on invite mode
	let saveButtonLabel: string = isInviteMode
		? __( 'Send invite', 'spacepress-admin' )
		: __( 'Save', 'spacepress-admin' );
	if ( isSaving ) {
		saveButtonLabel = isInviteMode
			? __( 'Sending…', 'spacepress-admin' )
			: __( 'Saving…', 'spacepress-admin' );
	} else if ( isSuccess && ! isDirty ) {
		saveButtonLabel = isInviteMode
			? __( 'Sent!', 'spacepress-admin' )
			: __( 'Saved!', 'spacepress-admin' );
	}

	const handleOnChange = useCallback(
		( value: Partial< ExtendedUser > ) => {
			setData( ( prevData ) => ( {
				...prevData,
				...value,
			} ) );
			setIsDirty( true );

			if ( isInviteMode && storeCreateError !== null ) {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- @wordpress/data dispatch returns untyped value
				void resetCreateInviteState();
			} else if ( ! isInviteMode ) {
				setLocalErrorMessage( undefined );
			}

			if ( isSuccess ) {
				setIsSuccess( false );
			}
		},
		[ isSuccess, isInviteMode, storeCreateError, resetCreateInviteState ]
	);

	const handleSubmit = useCallback( async () => {
		if ( isSaving ) {
			return;
		}

		try {
			if ( isInviteMode ) {
				// CIAB Invite Mode: Create invite via WordPress.com
				const role = Array.isArray( data.roles )
					? data.roles[ 0 ]
					: data.roles;

				// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- @wordpress/data dispatch returns untyped value
				await createInvite(
					data.email || '',
					role || '',
					data.invite_message
				);

				// Create success message with email
				const noticeId = 'invite-user-success-notice';
				void createSuccessNotice(
					sprintf(
						/* translators: %s: email address of invited user */
						__( '%s invited.', 'spacepress-admin' ),
						getUserDisplayName( data )
					),
					{
						type: 'snackbar',
						id: noticeId,
						icon: createElement( Icon, {
							icon: check,
							size: 24,
							fill: 'white',
							style: { position: 'relative', top: '2px' },
						} ),
						actions: [
							{
								label: createElement( Icon, {
									icon: close,
									size: 16,
									fill: 'white',
									style: {
										position: 'relative',
										top: '2px',
									},
								} ),
								onClick: () => removeNotice( noticeId ),
							},
						],
					}
				);
			} else {
				// Regular Mode: Create actual user
				setLocalIsSaving( true );
				await coreDispatch.saveEntityRecord( 'root', 'user', data );

				// Invalidate user queries
				void coreDispatch.invalidateResolution( 'getEntityRecords', [
					'root',
					'user',
				] );
			}

			setIsSuccess( true );
			setIsDirty( false );
			// Clear fields from local state after success
			setData( { roles: [ 'administrator' ] } );
			callbacks?.onSuccess?.();
		} catch ( error ) {
			callbacks?.onError?.( error );
			if ( ! isInviteMode ) {
				// apiFetch throws the response object directly, not an Error instance
				if (
					typeof error === 'object' &&
					error !== null &&
					'message' in error
				) {
					setLocalErrorMessage( String( error.message ) );
				} else {
					setLocalErrorMessage( String( error ) );
				}
			}
		} finally {
			if ( ! isInviteMode ) {
				setLocalIsSaving( false );
			}
		}
	}, [
		data,
		isSaving,
		coreDispatch,
		createInvite,
		isInviteMode,
		createSuccessNotice,
		removeNotice,
		callbacks,
	] );

	return {
		data,
		isDirty,
		isSaving,
		errorMessage,
		isSuccess,
		saveButtonLabel,
		handleOnChange,
		handleSubmit,
	};
}
