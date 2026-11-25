import { resolveSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { preloadFieldCollections } from '@spacepress-admin/core-data-next';

export const route = {
	loader: async () => {
		// Get current user data.
		const currentUser = await resolveSelect( coreStore ).getCurrentUser();

		if ( currentUser?.id ) {
			await resolveSelect( coreStore ).getEntityRecord(
				'root',
				'user',
				currentUser.id
			);

			await preloadFieldCollections( 'root', 'user' );
		}
	},
};
