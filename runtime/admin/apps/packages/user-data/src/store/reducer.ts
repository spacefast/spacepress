/**
 * Internal dependencies
 */
import type { Action } from './private-actions';
import type { State } from './types';

const DEFAULT_STATE: State = {
	isCreatingInvite: false,
	createInviteError: null,
	isDeletingInvites: false,
	deleteInvitesError: null,
	deletingInviteKeys: [],
};

/**
 * Reducer for managing user invite state.
 *
 * @param state  Current state.
 * @param action Dispatched action.
 * @return New state.
 */
export default function reducer(
	state: State = DEFAULT_STATE,
	action: Action
): State {
	switch ( action.type ) {
		case 'RECEIVE_CREATE_INVITE_START':
			return {
				...state,
				isCreatingInvite: true,
				createInviteError: null,
			};

		case 'RECEIVE_CREATE_INVITE_SUCCESS':
			return {
				...state,
				isCreatingInvite: false,
				createInviteError: null,
			};

		case 'RECEIVE_CREATE_INVITE_ERROR':
			return {
				...state,
				isCreatingInvite: false,
				createInviteError: action.error,
			};

		// Same state shape as SUCCESS, but semantically a user-initiated
		// reset (e.g., when the user edits the form after an error).
		case 'RESET_CREATE_INVITE':
			return {
				...state,
				isCreatingInvite: false,
				createInviteError: null,
			};

		case 'RECEIVE_DELETE_INVITES_START':
			return {
				...state,
				isDeletingInvites: true,
				deleteInvitesError: null,
				deletingInviteKeys: action.keys,
			};

		case 'RECEIVE_DELETE_INVITES_SUCCESS':
			return {
				...state,
				isDeletingInvites: false,
				deleteInvitesError: null,
				deletingInviteKeys: [],
			};

		case 'RECEIVE_DELETE_INVITES_ERROR':
			return {
				...state,
				isDeletingInvites: false,
				deleteInvitesError: action.error,
				deletingInviteKeys: [],
			};

		// Same state shape as SUCCESS, but semantically a user-initiated
		// reset (e.g., when retrying after a deletion error).
		case 'RESET_DELETE_INVITES':
			return {
				...state,
				isDeletingInvites: false,
				deleteInvitesError: null,
				deletingInviteKeys: [],
			};

		default:
			return state;
	}
}
