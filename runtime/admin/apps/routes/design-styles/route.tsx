import { resolveSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import StyleBook from './style-book';

function StyleBookCanvas( { postId }: { postId: string } ) {
	return <StyleBook id={ postId } />;
}

export const route = {
	canvas: async ( { search }: { search: { preview?: string } } ) => {
		// Get the current global styles ID for StyleBook editing
		const globalStylesId =
			await resolveSelect(
				coreStore
			).__experimentalGetCurrentGlobalStylesId();
		// A classic theme may not have a global styles ID, in which case we
		// default to the StyleBook canvas.
		if ( search.preview === 'stylebook' || ! globalStylesId ) {
			return {
				postType: 'wp_global_styles',
				postId: globalStylesId,
				component: StyleBookCanvas,
				isPreview: true,
			};
		}
		// Default to homepage preview
		return { isPreview: true };
	},
	inspector: async () => {
		// Only display the inspector if the theme has a global styles ID.
		const globalStylesId =
			await resolveSelect(
				coreStore
			).__experimentalGetCurrentGlobalStylesId();
		return !! globalStylesId;
	},
};
