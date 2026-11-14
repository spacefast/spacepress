import { useSyncExternalStore } from 'react';
import { useDispatch } from '@wordpress/data';
import { store as preferencesStore } from '@wordpress/preferences';

type ColorScheme = 'wpModernLight' | 'wpModernDark' | 'custom';
type InterfaceTheme = 'system' | ColorScheme;
export type ThemeColorSettings = {
	app: { background: string; primary: string };
	sidebar: { background: string; primary: string };
};

// A host page that embeds the admin sets the seeds, so it matches the page
// around it. Without a host the presets below apply.
let hostThemeColorSettings: ThemeColorSettings | undefined;
const hostThemeListeners = new Set< () => void >();

export function setHostThemeColorSettings(
	settings: ThemeColorSettings | undefined
): void {
	hostThemeColorSettings = settings;
	for ( const listener of hostThemeListeners ) listener();
}

function subscribeHostTheme( listener: () => void ): () => void {
	hostThemeListeners.add( listener );
	return () => hostThemeListeners.delete( listener );
}

function getHostTheme(): ThemeColorSettings | undefined {
	return hostThemeColorSettings;
}

const DEFAULT_INTERFACE_THEME: InterfaceTheme = 'wpModernLight';
const DEFAULT_INTERFACE_THEME_LIGHT: ColorScheme = 'wpModernLight';
const DEFAULT_INTERFACE_THEME_DARK: ColorScheme = 'wpModernDark';

const THEME_COLOR_PRESETS: Record< string, ThemeColorSettings > = {
	wpModernLight: {
		app: { background: '#fcfcfc', primary: '#3858e9' },
		sidebar: { background: '#f8f8f8', primary: '#3858e9' },
	},
	wpModernDark: {
		app: { background: '#fcfcfc', primary: '#3858e9' },
		sidebar: { background: '#1e1e1e', primary: '#3858e9' },
	},
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const PREFERENCE_NAMES = [
	'interfaceTheme',
	'interfaceThemeCustomAppBg',
	'interfaceThemeCustomAppPrimary',
	'interfaceThemeCustomSidebarBg',
	'interfaceThemeCustomSidebarPrimary',
	'interfaceThemeLight',
	'interfaceThemeLightCustomAppBg',
	'interfaceThemeLightCustomAppPrimary',
	'interfaceThemeLightCustomSidebarBg',
	'interfaceThemeLightCustomSidebarPrimary',
	'interfaceThemeDark',
	'interfaceThemeDarkCustomAppBg',
	'interfaceThemeDarkCustomAppPrimary',
	'interfaceThemeDarkCustomSidebarBg',
	'interfaceThemeDarkCustomSidebarPrimary',
] as const;

function createDefaults() {
	return {
		interfaceTheme: DEFAULT_INTERFACE_THEME,
		interfaceThemeLight: DEFAULT_INTERFACE_THEME_LIGHT,
		interfaceThemeDark: DEFAULT_INTERFACE_THEME_DARK,
		interfaceThemeCustomAppBg: THEME_COLOR_PRESETS.wpModernDark.app.background,
		interfaceThemeCustomAppPrimary:
			THEME_COLOR_PRESETS.wpModernDark.app.primary,
		interfaceThemeCustomSidebarBg:
			THEME_COLOR_PRESETS.wpModernDark.sidebar.background,
		interfaceThemeCustomSidebarPrimary:
			THEME_COLOR_PRESETS.wpModernDark.sidebar.primary,
		interfaceThemeLightCustomAppBg:
			THEME_COLOR_PRESETS.wpModernLight.app.background,
		interfaceThemeLightCustomAppPrimary:
			THEME_COLOR_PRESETS.wpModernLight.app.primary,
		interfaceThemeLightCustomSidebarBg:
			THEME_COLOR_PRESETS.wpModernLight.sidebar.background,
		interfaceThemeLightCustomSidebarPrimary:
			THEME_COLOR_PRESETS.wpModernLight.sidebar.primary,
		interfaceThemeDarkCustomAppBg: THEME_COLOR_PRESETS.wpModernDark.app.background,
		interfaceThemeDarkCustomAppPrimary:
			THEME_COLOR_PRESETS.wpModernDark.app.primary,
		interfaceThemeDarkCustomSidebarBg:
			THEME_COLOR_PRESETS.wpModernDark.sidebar.background,
		interfaceThemeDarkCustomSidebarPrimary:
			THEME_COLOR_PRESETS.wpModernDark.sidebar.primary,
	};
}

type ColorPreferences = ReturnType< typeof createDefaults >;

/**
 * For the MVP, we decided to not have a preference screens. So we're using the default values.
 *
 */
function useColorPreference() {
	// const prefs = useSelect( ( select ) => {
	// 	const defaults = createDefaults();

	// 	function getPref< T >( pref: string ): T | undefined {
	// 		return select( preferencesStore ).get( 'core/admin', pref );
	// 	}

	// 	function get< K extends keyof ColorPreferences >(
	// 		pref: K
	// 	): ColorPreferences[ K ] {
	// 		return getPref( pref ) || defaults[ pref ];
	// 	}

	// 	return Object.fromEntries(
	// 		PREFERENCE_NAMES.map( ( name ) => [ name, get( name ) ] )
	// 	) as ColorPreferences;
	// }, [] );

	// let themeColorSettings: ThemeColorSettings;
	// if ( prefs.interfaceTheme === 'custom' ) {
	// 	themeColorSettings = {
	// 		app: {
	// 			background: prefs.interfaceThemeCustomAppBg,
	// 			primary: prefs.interfaceThemeCustomAppPrimary,
	// 		},
	// 		sidebar: {
	// 			background: prefs.interfaceThemeCustomSidebarBg,
	// 			primary: prefs.interfaceThemeCustomSidebarPrimary,
	// 		},
	// 	};
	// } else {
	// 	themeColorSettings = THEME_COLOR_PRESETS[ prefs.interfaceTheme ];
	// }

	const hostTheme = useSyncExternalStore( subscribeHostTheme, getHostTheme );
	const { set } = useDispatch( preferencesStore );
	function setPreference(
		name: keyof ColorPreferences,
		value: ColorPreferences[ keyof ColorPreferences ]
	) {
		set( 'core/admin', name, value );
	}

	return {
		themeColorSettings: hostTheme ?? THEME_COLOR_PRESETS.wpModernDark,
		preferences: createDefaults(),
		setPreference,
	};
}

export default useColorPreference;
