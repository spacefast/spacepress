import { store as coreDataNextStore } from '@first-admin/core-data-next';
import loadAssets from '@first-admin/load-assets';
import { useState, useEffect } from '@wordpress/element';
import { resolveSelect, useSelect } from '@wordpress/data';

let loadAssetsPromise: Promise< void >;
let hostLoader: (() => Promise<void>) | undefined;

export function configureEditorAssets( load: () => Promise<void> ): void {
	hostLoader = load;
}

export async function loadEditorAssets() {
	const load = async () => {
		if (hostLoader) return hostLoader();
		const editorAssets =
			await resolveSelect( coreDataNextStore ).getEditorAssets();
		await loadAssets(
			editorAssets.scripts || {},
			editorAssets.inline_scripts || { before: {}, after: {} },
			editorAssets.styles || {},
			editorAssets.inline_styles || { before: {}, after: {} }
		);
	};

	if ( ! loadAssetsPromise ) {
		loadAssetsPromise = load();
	}

	return loadAssetsPromise;
}

/**
 * This is a React hook that handles loading editor assets from the REST API.
 *
 * @return Editor assets loading state.
 */
export function useEditorAssets() {
	const editorAssets = useSelect( ( select ) => {
		return select( coreDataNextStore ).getEditorAssets();
	}, [] );

	const [ assetsLoaded, setAssetsLoaded ] = useState( false );

	useEffect( () => {
		if ( (hostLoader || editorAssets) && ! assetsLoaded ) {
			loadEditorAssets()
				.then( () => {
					setAssetsLoaded( true );
				} )
				.catch( ( error: Error ) => {
					// eslint-disable-next-line no-console
					console.error( 'Failed to load editor assets:', error );
				} );
		}
	}, [ editorAssets, assetsLoaded ] );

	return {
		isReady: ( !! hostLoader || !! editorAssets ) && assetsLoaded,
		assetsLoaded,
	};
}
