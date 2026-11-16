/**
 * Action to set creating invite loading state.
 *
 * @return Action object.
 */
export function receiveCreateInviteStart() {
	return {
		type: 'RECEIVE_CREATE_INVITE_START',
	} as const;
}

/**
 * Action to set creating invite success state.
 *
 * @return Action object.
 */
export function receiveCreateInviteSuccess() {
	return {
		type: 'RECEIVE_CREATE_INVITE_SUCCESS',
	} as const;
}

/**
 * Action to set creating invite error state.
 *
 * @param error The error message.
 * @return Action object.
 */
export function receiveCreateInviteError( error: string ) {
	return {
		type: 'RECEIVE_CREATE_INVITE_ERROR',
		error,
	} as const;
}

/**
 * Action to set deleting invites loading state.
 *
 * @param keys The invite keys being deleted.
 * @return Action object.
 */
export function receiveDeleteInvitesStart( keys: string[] ) {
	return {
		type: 'RECEIVE_DELETE_INVITES_START',
		keys,
	} as const;
}

/**
 * Action to set deleting invites success state.
 *
 * @return Action object.
 */
export function receiveDeleteInvitesSuccess() {
	return {
		type: 'RECEIVE_DELETE_INVITES_SUCCESS',
	} as const;
}

/**
 * Action to set deleting invites error state.
 *
 * @param error The error message.
 * @return Action object.
 */
export function receiveDeleteInvitesError( error: string ) {
	return {
		type: 'RECEIVE_DELETE_INVITES_ERROR',
		error,
	} as const;
}

/**
 * Action to reset create invite state to defaults.
 *
 * @return Action object.
 */
export function resetCreateInvite() {
	return {
		type: 'RESET_CREATE_INVITE',
	} as const;
}

/**
 * Action to reset delete invites state to defaults.
 *
 * @return Action object.
 */
export function resetDeleteInvites() {
	return {
		type: 'RESET_DELETE_INVITES',
	} as const;
}

export type Action =
	| ReturnType< typeof receiveCreateInviteStart >
	| ReturnType< typeof receiveCreateInviteSuccess >
	| ReturnType< typeof receiveCreateInviteError >
	| ReturnType< typeof receiveDeleteInvitesStart >
	| ReturnType< typeof receiveDeleteInvitesSuccess >
	| ReturnType< typeof receiveDeleteInvitesError >
	| ReturnType< typeof resetCreateInvite >
	| ReturnType< typeof resetDeleteInvites >;
