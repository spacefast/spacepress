/**
 * Internal dependencies
 */
import type { State } from './types';

/**
 * Returns whether an invite is currently being created.
 *
 * @param state Current state.
 * @return True if creating an invite.
 */
export function isCreatingInvite( state: State ): boolean {
	return state.isCreatingInvite;
}

/**
 * Returns the error message from the last invite creation attempt.
 *
 * @param state Current state.
 * @return Error message or null.
 */
export function getCreateInviteError( state: State ): string | null {
	return state.createInviteError;
}

/**
 * Returns whether invites are currently being deleted.
 *
 * @param state Current state.
 * @return True if deleting invites.
 */
export function isDeletingInvites( state: State ): boolean {
	return state.isDeletingInvites;
}

/**
 * Returns the error message from the last invite deletion attempt.
 *
 * @param state Current state.
 * @return Error message or null.
 */
export function getDeleteInvitesError( state: State ): string | null {
	return state.deleteInvitesError;
}

/**
 * Returns whether a specific invite key is currently being deleted.
 *
 * @param state Current state.
 * @param key   The invite key to check.
 * @return True if the invite is being deleted.
 */
export function isDeletingInviteKey( state: State, key: string ): boolean {
	return state.deletingInviteKeys.includes( key );
}
