import type { ExtendedUser, UserViewConfigData } from './types';

/**
 * Check if a user or user ID represents an invite user.
 *
 * Invite users are identified by:
 * - Negative user IDs (by convention)
 * - The is_invite flag set to true
 *
 * @param userOrId - User object, user ID, or undefined
 * @return True if this represents an invite user
 *
 * @example
 * // Check by ID
 * isInviteUser( -12345 ) // true
 * isInviteUser( 123 )    // false
 *
 * // Check by user object
 * isInviteUser( { id: -12345, is_invite: true, ... } ) // true
 * isInviteUser( { id: 123, ... } )                     // false
 */
export function isInviteUser(
	userOrId: ExtendedUser | number | undefined
): boolean {
	if ( userOrId === undefined || userOrId === null ) {
		return false;
	}

	// If it's a number (user ID), check if it's negative
	if ( typeof userOrId === 'number' ) {
		return userOrId < 0;
	}

	// If it's a user object, check both the flag and the ID
	return userOrId.is_invite === true || userOrId.id < 0;
}

/**
 * Check if a user is a pending invite.
 *
 * A pending invite is an invite user that has not yet been accepted.
 *
 * @param {ExtendedUser} user - The user object to check.
 * @return True if this is a pending invite
 *
 * @example
 * isPendingInvite( { id: -12345, is_invite: true, is_pending: true, ... } ) // true
 * isPendingInvite( { id: -12345, is_invite: true, is_pending: false, ... } ) // false
 * isPendingInvite( { id: 123, ... } ) // false
 */
export function isPendingInvite( user: ExtendedUser ): boolean {
	return isInviteUser( user ) && user.is_pending === true;
}

/**
 * Check if a user is the store owner.
 *
 * Uses the is_store_owner property from the REST API which is determined
 * by the backend based on the Jetpack connection owner.
 *
 * @param user - User object
 * @return True if this is the store owner
 */
export function isStoreOwner( user: ExtendedUser ): boolean {
	return Boolean( user.is_store_owner );
}

/**
 * Get user display name for notifications.
 * Prioritizes email over name to ensure consistency with the user list display.
 *
 * @param user       - User object with optional name and email
 * @param user.name
 * @param user.email
 * @return Display name (email preferred, name as fallback)
 */
export function getUserDisplayName( user: {
	name?: string;
	email?: string;
} ): string {
	return user.email || ( user.name !== '–' && user.name ) || '';
}

/**
 * Check if site is in invite mode (CIAB).
 * @param viewConfig
 */
export function isInInviteMode(
	viewConfig?: UserViewConfigData | null
): boolean {
	return viewConfig?.is_invite_mode ?? false;
}
