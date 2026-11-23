import {
	generateGlobalStyles,
	mergeGlobalStyles,
	type GlobalStylesConfig,
} from '@wordpress/global-styles-engine';
import { privateApis as themePrivateApis } from '@wordpress/theme';
import { unlock } from '@spacepress-admin/private-apis';

// A private API of @wordpress/theme (no public replacement yet), unlocked as core's packages do.
const { useThemeProviderStyles } = unlock( themePrivateApis ) as {
	useThemeProviderStyles: ( options?: {
		color?: { primary?: string; background?: string };
	} ) => { themeProviderStyles: Record< string, string > | null };
};
import { store as coreDataNextStore } from '@spacepress-admin/core-data-next';
import { store as coreStore } from '@wordpress/core-data';
import { useMemo, useSyncExternalStore } from '@wordpress/element';
import { useSelect } from '@wordpress/data';
import { useUserGlobalStyles } from './use-global-styles';
import {
	getEditorCanvasStyles,
	subscribeEditorCanvasStyles,
} from './editor-canvas-styles';

/**
 * This is a React hook that provides the editor settings from the REST API.
 *
 * @param {Object} props            - The props object.
 * @param {string} [props.stylesId] - The ID of the user's global styles to use.
 * @return Editor settings.
 */
export function useEditorSettings( { stylesId }: { stylesId: string } ) {
	const { baseGlobalStyles, editorSettings } = useSelect< {
		baseGlobalStyles: GlobalStylesConfig | undefined;
		editorSettings: {
			styles: Array< any >;
		};
	} >(
		( select ) => ( {
			baseGlobalStyles:
				select(
					coreStore
				).__experimentalGetCurrentThemeBaseGlobalStyles(),
			editorSettings: select( coreDataNextStore ).getEditorSettings(),
		} ),
		[]
	);
	const { user: userGlobalStyles } = useUserGlobalStyles( stylesId );
	// The block styles in the config need the block types, which the editor
	// assets register after this hook first runs; regenerate once they exist.
	const blockTypes = useSelect(
		( select ) =>
			(
				select( 'core/blocks' ) as unknown as {
					getBlockTypes: () => unknown[];
				}
			 ).getBlockTypes(),
		[]
	);

	const [ globalStylesCSS, globalSettingsForFeatures ] = useMemo( () => {
		let mergedStyles;
		if ( ! baseGlobalStyles && userGlobalStyles ) {
			mergedStyles = userGlobalStyles;
		} else if ( ! userGlobalStyles && baseGlobalStyles ) {
			mergedStyles = baseGlobalStyles;
		} else if ( baseGlobalStyles && userGlobalStyles ) {
			mergedStyles = mergeGlobalStyles(
				baseGlobalStyles,
				userGlobalStyles
			);
		}
		return generateGlobalStyles( mergedStyles );
	}, [ baseGlobalStyles, userGlobalStyles, blockTypes ] );

	const { themeProviderStyles } = useThemeProviderStyles();
	const themeProviderStylesString = useMemo( () => {
		return {
			css: `
				:root {
					${ Object.entries( themeProviderStyles ?? {} )
						.map( ( [ key, value ] ) => `${ key }: ${ value };` )
						.join( '\n' ) }
				}
			`,
		};
	}, [ themeProviderStyles ] );
	const canvasStyles = useSyncExternalStore(
		subscribeEditorCanvasStyles,
		getEditorCanvasStyles
	);
	const hasEditorSettings = !! editorSettings;
	const styles = useMemo( () => {
		if ( ! hasEditorSettings ) {
			return [];
		}
		// The host's theme sheet follows the provider's tokens, so what it
		// sets on the canvas root wins; the global styles come last and are
		// written against it.
		return [
			...canvasStyles.base,
			...( editorSettings?.styles ?? [] ),
			themeProviderStylesString,
			...canvasStyles.theme,
			...globalStylesCSS,
		];
	}, [
		hasEditorSettings,
		canvasStyles,
		editorSettings?.styles,
		themeProviderStylesString,
		globalStylesCSS,
	] );

	return {
		isReady: hasEditorSettings,
		editorSettings: useMemo(
			() => ( {
				...( editorSettings ?? {} ),
				styles,
				__experimentalFeatures: globalSettingsForFeatures,
			} ),
			[ editorSettings, styles, globalSettingsForFeatures ]
		),
	};
}
