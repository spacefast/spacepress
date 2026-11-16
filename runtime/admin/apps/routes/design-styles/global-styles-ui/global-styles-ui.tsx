import { Navigator, useNavigator } from '@wordpress/components';
// @ts-expect-error - No type declarations available for @wordpress/block-editor
import { BlockEditorProvider } from '@wordpress/block-editor';
import { useMemo, useEffect } from '@wordpress/element';
import {
	generateGlobalStyles,
	mergeGlobalStyles,
} from '@typedpress-admin/global-styles-engine';
import type { GlobalStylesConfig } from '@typedpress-admin/global-styles-engine';
import './style.scss';
import { GlobalStylesProvider } from './provider';
import ScreenRoot from './screen-root';
import ScreenBlockList from './screen-block-list';
import ScreenBlock from './screen-block';
import ScreenTypography from './screen-typography';
import ScreenTypographyElement from './screen-typography-element';
import ScreenColors from './screen-colors';
import ScreenColorPalette from './screen-color-palette';
import ScreenBackground from './screen-background';
import { ScreenShadows, ScreenShadowsEdit } from './screen-shadows';
import ScreenLayout from './screen-layout';
import ScreenStyleVariations from './screen-style-variations';
import ScreenCSS from './screen-css';
import ScreenRevisions from './screen-revisions';
import FontSizes from './font-sizes/font-sizes';
import FontSize from './font-sizes/font-size';

function ScreenBlockFromParams() {
	const { params } = useNavigator();
	const blockName = params?.blockName;

	if ( ! blockName || typeof blockName !== 'string' ) {
		return null;
	}

	return <ScreenBlock name={ decodeURIComponent( blockName ) } />;
}

function ScreenBlockVariationFromParams() {
	const { params } = useNavigator();
	const blockName = params?.blockName;
	const variation = params?.variation;

	if (
		! blockName ||
		typeof blockName !== 'string' ||
		! variation ||
		typeof variation !== 'string'
	) {
		return null;
	}

	return (
		<ScreenBlock
			name={ decodeURIComponent( blockName ) }
			variation={ decodeURIComponent( variation ) }
		/>
	);
}

function ScreenBlockPaletteFromParams() {
	const { params } = useNavigator();
	const blockName = params?.blockName;

	if ( ! blockName || typeof blockName !== 'string' ) {
		return null;
	}

	return <ScreenColorPalette name={ decodeURIComponent( blockName ) } />;
}

interface GlobalStylesUIProps {
	/** User global styles object (what gets edited) */
	value: GlobalStylesConfig;
	/** Base global styles object (theme default) */
	baseValue: GlobalStylesConfig;
	/** Callback when global styles change */
	onChange: ( newValue: GlobalStylesConfig ) => void;
	/** Current navigation path (optional) */
	path?: string;
	/** Callback when navigation path changes (optional) */
	onPathChange?: ( path: string ) => void;
	/** Whether font library is enabled (optional) */
	fontLibraryEnabled?: boolean;
	/** Server CSS styles for BlockEditorProvider (optional) */
	serverCSS?: { isGlobalStyles?: boolean }[];
	/** Server settings for BlockEditorProvider (optional) */
	serverSettings?: { __unstableResolvedAssets: Record< string, unknown > };
}

export function GlobalStylesUI( {
	value,
	baseValue,
	onChange,
	path,
	onPathChange,
	fontLibraryEnabled = false,
	serverCSS,
	serverSettings,
}: GlobalStylesUIProps ) {
	// Compute merged value for CSS generation
	const mergedValue = useMemo( () => {
		return mergeGlobalStyles( baseValue, value );
	}, [ baseValue, value ] );

	const [ globalStylesCSS, globalSettings ] =
		generateGlobalStyles( mergedValue );
	const styles = useMemo(
		() => [ ...( serverCSS ?? [] ), ...( globalStylesCSS ?? [] ) ],
		[ serverCSS, globalStylesCSS ]
	);

	const settings = useMemo( () => {
		return {
			...serverSettings,
			__experimentalFeatures: globalSettings,
			styles,
		};
	}, [ globalSettings, serverSettings, styles ] );

	return (
		<GlobalStylesProvider
			value={ value }
			baseValue={ baseValue }
			onChange={ onChange }
			fontLibraryEnabled={ fontLibraryEnabled }
		>
			<BlockEditorProvider settings={ settings }>
				<Navigator initialPath={ path || '/' }>
					{ ( path || onPathChange ) && (
						<PathSynchronizer
							path={ path }
							onPathChange={ onPathChange }
						/>
					) }
					<Navigator.Screen path="/">
						<ScreenRoot />
					</Navigator.Screen>
					<Navigator.Screen path="/colors">
						<ScreenColors />
					</Navigator.Screen>
					<Navigator.Screen path="/typography">
						<ScreenTypography />
					</Navigator.Screen>
					<Navigator.Screen path="/typography/font-sizes">
						<FontSizes />
					</Navigator.Screen>
					<Navigator.Screen path="/typography/font-sizes/:origin/:slug">
						<FontSize />
					</Navigator.Screen>
					<Navigator.Screen path="/layout">
						<ScreenLayout />
					</Navigator.Screen>
					<Navigator.Screen path="/colors/palette">
						<ScreenColorPalette />
					</Navigator.Screen>
					<Navigator.Screen path="/variations">
						<ScreenStyleVariations />
					</Navigator.Screen>
					<Navigator.Screen path="/css">
						<ScreenCSS />
					</Navigator.Screen>
					<Navigator.Screen path="/revisions">
						<ScreenRevisions />
					</Navigator.Screen>
					<Navigator.Screen path="/shadows">
						<ScreenShadows />
					</Navigator.Screen>
					<Navigator.Screen path="/shadows/edit/:category/:slug">
						<ScreenShadowsEdit />
					</Navigator.Screen>
					<Navigator.Screen path="/background">
						<ScreenBackground />
					</Navigator.Screen>
					<Navigator.Screen path="/typography/text">
						<ScreenTypographyElement element="text" />
					</Navigator.Screen>
					<Navigator.Screen path="/typography/link">
						<ScreenTypographyElement element="link" />
					</Navigator.Screen>
					<Navigator.Screen path="/typography/heading">
						<ScreenTypographyElement element="heading" />
					</Navigator.Screen>
					<Navigator.Screen path="/typography/caption">
						<ScreenTypographyElement element="caption" />
					</Navigator.Screen>
					<Navigator.Screen path="/typography/button">
						<ScreenTypographyElement element="button" />
					</Navigator.Screen>
					<Navigator.Screen path="/blocks">
						<ScreenBlockList />
					</Navigator.Screen>
					<Navigator.Screen path="/blocks/:blockName">
						<ScreenBlockFromParams />
					</Navigator.Screen>
					<Navigator.Screen path="/blocks/:blockName/colors/palette">
						<ScreenBlockPaletteFromParams />
					</Navigator.Screen>
					<Navigator.Screen path="/blocks/:blockName/variations/:variation">
						<ScreenBlockVariationFromParams />
					</Navigator.Screen>
				</Navigator>
			</BlockEditorProvider>
		</GlobalStylesProvider>
	);
}

/*
 * Component that handles path synchronization between external path prop and Navigator's internal path
 */
function PathSynchronizer( {
	path,
	onPathChange,
}: {
	path?: string;
	onPathChange?: ( path: string ) => void;
} ) {
	const navigator = useNavigator();
	const { path: currentPath } = navigator.location;

	// When path changes, we want to update the Navigator's path.
	useEffect( () => {
		if ( path ) {
			navigator.goTo( path );
		}
		// including `navigator` in the dependency array would cause `Maximum update depth exceeded.` errors.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ path ] );

	// When currentPath changes, we want to call onPathChange if provided.
	useEffect( () => {
		if ( onPathChange && currentPath ) {
			onPathChange( currentPath );
		}
	}, [ currentPath, onPathChange ] );

	// This component only handles synchronization logic. It doesn't render anything.
	// We use it to run the effect inside the Navigator context.
	return null;
}
