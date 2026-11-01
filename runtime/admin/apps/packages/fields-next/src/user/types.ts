import type { User as WPUser } from '@wordpress/core-data';

export interface User extends WPUser {
	/**
	 * Number of posts by the user.
	 */
	post_count?: number;
}
