import { resolveSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { store as preferencesStore } from '@wordpress/preferences';

export const route = {
	loader: async () => {
		await Promise.all( [
			resolveSelect( coreStore ).getEntityRecord( 'root', 'site' ),
			resolveSelect( coreStore ).getEntityRecords( 'postType', 'page', {
				per_page: -1,
			} ),
		] );
	},
	canvas: async () => {
		const showCanvas = await resolveSelect( preferencesStore ).get(
			'core/settings-route',
			'showCanvas'
		);
		if ( showCanvas === false ) {
			return;
		}
		const theme = await resolveSelect( coreStore ).getCurrentTheme();
		// If a theme is not a block theme, it won't have block templates
		// and won't respond to entities.
		if ( ! theme.is_block_theme ) {
			return;
		}
		return { isPreview: true, editLink: null };
	},
};
