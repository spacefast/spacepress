import { type Term } from '@wordpress/core-data';

export type TermWithPermissions = Term & {
	permissions: {
		delete: boolean;
		update: boolean;
	};
};
