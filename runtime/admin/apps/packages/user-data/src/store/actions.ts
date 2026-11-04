// This package is a data store that needs direct API access for invite operations.
// eslint-disable-next-line no-restricted-imports
import apiFetch from '@wordpress/api-fetch';
import { store as coreStore } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import type * as privateActions from './private-actions';

/**
 * Dispatch type for thunk actions based on private actions.
 */
type Dispatch = {
	[ ActionName in keyof typeof privateActions ]: (
		...args: Parameters< ( typeof privateActions )[ ActionName ] >
	) => void;
};

/**
 * Registry type for accessing other stores.
 */
interface Registry {
	dispatch: ( store: typeof coreStore ) => {
		invalidateResolutionForStoreSelector: ( selector: string ) => void;
	};
}

/**
 * Thunk arguments passed to actions.
 */
interface ThunkArgs {
	dispatch: Dispatch;
	registry: Registry;
}

/**
 * Extracts a human-readable message from an unknown error.
 *
 * @param error    The caught error value.
 * @param fallback Fallback message when extraction fails.
 * @return The extracted or fallback error message.
 */
function extractErrorMessage( error: unknown, fallback: string ): string {
	if (
		error &&
		typeof error === 'object' &&
		'message' in error &&
		typeof error.message === 'string'
	) {
		return error.message;
	}
	return fallback;
}

/**
 * Creates a user invite.
 *
 * @param email   The email address to invite.
 * @param role    The role to assign to the invited user.
 * @param message Optional custom invite message.
 * @return Thunk action.
 */
export const createInvite =
	( email: string, role: string, message?: string ) =>
	async ( { dispatch, registry }: ThunkArgs ) => {
		dispatch.receiveCreateInviteStart();

		try {
			const data: {
				email: string;
				role: string;
				invite_message?: string;
			} = {
				email,
				role,
			};

			if ( message ) {
				data.invite_message = message;
			}

			await apiFetch< { success: boolean; message?: string } >( {
				path: '/wp/v2/users/invite',
				method: 'POST',
				data,
			} );

			dispatch.receiveCreateInviteSuccess();

			// TODO: This invalidates all entity resolutions app-wide, not just
			// users. Scope to ['root', 'user'] when core-data supports it.
			registry
				.dispatch( coreStore )
				.invalidateResolutionForStoreSelector( 'getEntityRecords' );
		} catch ( error ) {
			dispatch.receiveCreateInviteError(
				extractErrorMessage(
					error,
					__( 'Failed to create invite', 'zero-admin' )
				)
			);
			throw error;
		}
	};

/**
 * Deletes user invites.
 *
 * @param inviteKeys Array of invite keys to delete.
 * @return Thunk action.
 */
export const deleteInvites =
	( inviteKeys: string[] ) =>
	async ( { dispatch, registry }: ThunkArgs ) => {
		dispatch.receiveDeleteInvitesStart( inviteKeys );

		try {
			await apiFetch< { success: boolean; message?: string } >( {
				path: '/wp/v2/users/invite/delete',
				method: 'POST',
				data: { invite_keys: inviteKeys },
			} );

			dispatch.receiveDeleteInvitesSuccess();

			// TODO: This invalidates all entity resolutions app-wide, not just
			// users. Scope to ['root', 'user'] when core-data supports it.
			registry
				.dispatch( coreStore )
				.invalidateResolutionForStoreSelector( 'getEntityRecords' );
		} catch ( error ) {
			dispatch.receiveDeleteInvitesError(
				extractErrorMessage(
					error,
					__( 'Failed to delete invites', 'zero-admin' )
				)
			);
			throw error;
		}
	};

/**
 * Resets the create-invite loading and error state to defaults.
 *
 * @return Thunk action.
 */
export const resetCreateInviteState =
	() =>
	( { dispatch }: Pick< ThunkArgs, 'dispatch' > ) => {
		dispatch.resetCreateInvite();
	};

/**
 * Resets the delete-invites loading and error state to defaults.
 *
 * @return Thunk action.
 */
export const resetDeleteInvitesState =
	() =>
	( { dispatch }: Pick< ThunkArgs, 'dispatch' > ) => {
		dispatch.resetDeleteInvites();
	};
