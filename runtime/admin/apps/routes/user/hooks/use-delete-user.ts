import { Icon } from '@wordpress/ui';
import { store as userDataStore } from '@zero-admin/user-data';
import { __, _n, sprintf } from '@wordpress/i18n';
import { select as wpSelect, useDispatch, useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { store as noticesStore } from '@wordpress/notices';
import { useCallback, useState, createElement } from '@wordpress/element';
import type { User } from '@wordpress/core-data';
import { check, close } from '@wordpress/icons';
import { isInviteUser, getUserDisplayName } from '../utils';
import type { ExtendedUser } from '../types';

interface DeleteUserOptions {
	onSuccess?: () => void;
	onError?: ( error: Error ) => void;
	excludeUserIds?: number[];
}

/**
 * Hook to handle user deletion logic.
 * Supports both single and bulk deletion of regular users and invite users.
 *
 * @param options - Configuration options for the delete hook
 * @return Object containing deleteUsers function and isBusy state
 *
 * @example
 * // Delete single user
 * const { deleteUsers, isBusy } = useDeleteUser();
 * deleteUsers(user);
 *
 * // Delete multiple users
 * deleteUsers([user1, user2, user3]);
 */
export function useDeleteUser( options: DeleteUserOptions = {} ) {
	const [ isDeletingRegularUsers, setIsDeletingRegularUsers ] =
		useState( false );
	const { createSuccessNotice, createErrorNotice, removeNotice } =
		useDispatch( noticesStore );
	const { deleteEntityRecord } = useDispatch( coreStore );
	const { deleteInvites } = useDispatch( userDataStore );

	// Read invite deletion state from the store.
	// TODO: Module-level select() is used instead of the callback parameter
	// because a @wordpress/data version mismatch prevents proper type
	// resolution. Remove when versions are aligned.
	const isDeletingInvites = useSelect(
		() => wpSelect( userDataStore ).isDeletingInvites(),
		[]
	);

	// Composite: busy if either regular users or invites are being deleted
	const isBusy = isDeletingRegularUsers || isDeletingInvites;

	// Get author users for post reassignment
	const authorUsers = useSelect(
		( select ) => {
			if (
				! options.excludeUserIds ||
				options.excludeUserIds.length === 0
			) {
				return select( coreStore ).getUsers( {
					who: 'authors',
				} );
			}
			return select( coreStore ).getUsers( {
				who: 'authors',
				exclude: options.excludeUserIds.join( ',' ),
			} );
		},
		[ options.excludeUserIds ]
	);
	const reassignToUserId = authorUsers?.[ 0 ]?.id;

	const deleteUsers = useCallback(
		async ( users: User | User[] ) => {
			// Normalize to array
			const usersArray = Array.isArray( users ) ? users : [ users ];

			// Separate invite users from regular users
			const inviteUsers = usersArray.filter( ( user: User ) =>
				isInviteUser( user )
			);
			const regularUsers = usersArray.filter(
				( user: User ) => ! isInviteUser( user )
			);

			if ( regularUsers.length > 0 ) {
				setIsDeletingRegularUsers( true );
			}

			try {
				const promises: Promise< unknown >[] = [];

				// Delete regular users via entity record
				if ( regularUsers.length > 0 ) {
					promises.push(
						...regularUsers.map( ( user: User ) =>
							deleteEntityRecord(
								'root',
								'user',
								user.id.toString(),
								{
									reassign: reassignToUserId,
									force: true,
								},
								{ throwOnError: true }
							)
						)
					);
				}

				// Delete invite users via user data store
				if ( inviteUsers.length > 0 ) {
					const inviteKeys = inviteUsers
						.map( ( user: ExtendedUser ) => user.invite_key )
						.filter( ( key ): key is string => Boolean( key ) );

					if ( inviteKeys.length > 0 ) {
						promises.push( deleteInvites( inviteKeys ) );
					}
				}

				const promiseResult = await Promise.allSettled( promises );

				// If all the promises were fulfilled with success.
				if (
					promiseResult.every(
						( { status } ) => status === 'fulfilled'
					)
				) {
					const successMessage =
						usersArray.length === 1
							? sprintf(
									/* translators: %s: user name or email */
									__( '%s deleted.', 'zero-admin' ),
									getUserDisplayName( usersArray[ 0 ] )
							  )
							: sprintf(
									/* translators: %d: The number of users. */
									_n(
										'%d user deleted.',
										'%d users deleted.',
										usersArray.length,
										'zero-admin'
									),
									usersArray.length
							  );

					const noticeId = 'delete-user-success-notice';
					void createSuccessNotice( successMessage, {
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
					} );
				} else {
					// Extract error messages from rejected promises
					/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- PromiseRejectedResult.reason is typed as any */
					const errors = promiseResult
						.filter(
							( result ): result is PromiseRejectedResult =>
								result.status === 'rejected'
						)
						.map( ( result ) => {
							const error = result.reason;
							// Extract message from different error formats
							if ( typeof error === 'string' ) {
								return error;
							}
							if ( error?.message ) {
								return error.message;
							}
							if ( error?.data?.message ) {
								return error.data.message;
							}
							return __( 'Unknown error', 'zero-admin' );
						} );

					const errorMessage =
						errors.length > 0
							? errors[ 0 ]
							: __(
									'An error occurred while deleting users.',
									'zero-admin'
							  );
					void createErrorNotice( errorMessage, {
						type: 'snackbar',
					} );
					/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
				}

				if (
					promiseResult.every(
						( { status } ) => status === 'fulfilled'
					)
				) {
					if ( options.onSuccess ) {
						options.onSuccess();
					}
				} else if (
					promiseResult.some(
						( { status } ) => status === 'rejected'
					)
				) {
					// Extract the first error for the callback
					const firstError = promiseResult.find(
						( result ): result is PromiseRejectedResult =>
							result.status === 'rejected'
					);
					/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Pre-existing: firstError.reason is typed as any */
					const error =
						firstError?.reason instanceof Error
							? firstError.reason
							: new Error(
									firstError?.reason?.message ||
										firstError?.reason?.data?.message ||
										__(
											'Some users failed to delete',
											'zero-admin'
										)
							  );
					/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */

					if ( options.onError ) {
						options.onError( error );
					}
				}
			} finally {
				if ( regularUsers.length > 0 ) {
					setIsDeletingRegularUsers( false );
				}
			}
		},
		[
			createSuccessNotice,
			createErrorNotice,
			deleteEntityRecord,
			deleteInvites,
			reassignToUserId,
			options,
			removeNotice,
		]
	);

	return {
		deleteUsers,
		isBusy,
	};
}
