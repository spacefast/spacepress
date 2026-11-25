import { resolveSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import {
	preloadFieldCollections,
	loadViewConfig,
} from '@spacepress-admin/core-data-next';

export const route = {
	loader: async () => {
		await Promise.all( [
			resolveSelect( coreStore ).canUser( 'create', {
				kind: 'root',
				name: 'user',
			} ),
			preloadFieldCollections( 'root', 'user' ),
			loadViewConfig( 'root', 'user' ),
		] );
	},
};
