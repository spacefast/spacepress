import { resolveSelect } from '@wordpress/data';
import { store as preferencesStore } from '@wordpress/preferences';

export const route = {
	loader: async () => {
		// Ensure preferences are loaded for experiments
		await resolveSelect( preferencesStore ).get(
			'core/experiments',
			'enabled'
		);
	},
};
