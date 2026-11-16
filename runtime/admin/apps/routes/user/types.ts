import type { User } from '@wordpress/core-data';

/**
 * Extended User type that includes invite-specific properties.
 * Use this type when working with users that may have invite-related data.
 */
export interface ExtendedUser extends User {
	/**
	 * Whether this is an invite user (not a registered user yet).
	 */
	is_invite?: boolean;

	/**
	 * The invite key for invite users.
	 */
	invite_key?: string;

	/**
	 * Whether the invite is pending (not yet accepted).
	 */
	is_pending?: boolean;

	/**
	 * The date the invite was created.
	 */
	invite_date?: string;

	/**
	 * Optional message to include with the invite.
	 */
	invite_message?: string;

	/**
	 * Whether this user is the store owner.
	 */
	is_store_owner?: boolean;
}

/**
 * Extended view config data that includes user-specific configuration.
 */
export interface UserViewConfigData {
	/**
	 * Fields that should be readonly in different forms.
	 */
	readonly_fields?: {
		edit_form?: string[];
	};

	/**
	 * Whether the site is in invite mode (CIAB).
	 */
	is_invite_mode?: boolean;
}
