import { resolveSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import {
	preloadFieldCollections,
	loadViewConfig,
} from '@zero-admin/core-data-next';
import { isInviteUser } from '../user/utils';

export const route = {
	loader: async ( { params }: { params: { userId: string } } ) => {
		const userId = Number( params.userId );

		// For invite users, preload the users list where invites are merged via REST API
		// For regular users, load the individual entity record
		if ( isInviteUser( userId ) ) {
			await resolveSelect( coreStore ).getEntityRecords( 'root', 'user' );
		} else {
			await resolveSelect( coreStore ).getEntityRecord(
				'root',
				'user',
				params.userId
			);
		}

		await Promise.all( [
			preloadFieldCollections( 'root', 'user' ),
			loadViewConfig( 'root', 'user' ),
		] );
	},
};
