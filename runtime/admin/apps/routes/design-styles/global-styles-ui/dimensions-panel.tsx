// @ts-expect-error - WordPress private APIs
import { privateApis as blockEditorPrivateApis } from '@wordpress/block-editor';
import { useMemo } from '@wordpress/element';
import { unlock } from '@first-admin/admin-toolkit';
import { useStyle, useSetting } from './hooks';

const { useSettingsForBlockElement, DimensionsPanel: StylesDimensionsPanel } =
	unlock( blockEditorPrivateApis );

const DEFAULT_CONTROLS = {
	contentSize: true,
	wideSize: true,
	padding: true,
	margin: true,
	blockGap: true,
	minHeight: true,
	childLayout: false,
};

export default function DimensionsPanel() {
	const [ style ] = useStyle( '', undefined, 'user', false );
	const [ inheritedStyle, setStyle ] = useStyle(
		'',
		undefined,
		'merged',
		false
	);
	const [ userSettings ] = useSetting( '', undefined, 'user' );
	const [ rawSettings, setSettings ] = useSetting( '' );
	const settings = useSettingsForBlockElement( rawSettings );

	// These intermediary objects are needed because the "layout" property is stored
	// in settings rather than styles.
	const inheritedStyleWithLayout = useMemo( () => {
		return {
			...inheritedStyle,
			layout: settings.layout,
		};
	}, [ inheritedStyle, settings.layout ] );

	const styleWithLayout = useMemo( () => {
		return {
			...style,
			layout: userSettings.layout,
		};
	}, [ style, userSettings.layout ] );

	const onChange = ( newStyle: any ) => {
		const updatedStyle = { ...newStyle };
		delete updatedStyle.layout;
		setStyle( updatedStyle );

		if ( newStyle.layout !== userSettings.layout ) {
			const updatedSettings = {
				...userSettings,
				layout: newStyle.layout,
			};

			const normalizedLayout = Object.entries(
				updatedSettings.layout || {}
			).reduce( ( acc, [ key, value ] ) => {
				return {
					...acc,
					[ key ]: value ?? settings.layout?.[ key ],
				};
			}, {} );

			// Ensure any changes to layout definitions are not persisted.
			if ( updatedSettings.layout?.definitions ) {
				delete updatedSettings.layout.definitions;
			}

			setSettings( {
				...updatedSettings,
				layout: normalizedLayout,
			} );
		}
	};

	return (
		<StylesDimensionsPanel
			inheritedValue={ inheritedStyleWithLayout }
			value={ styleWithLayout }
			onChange={ onChange }
			settings={ settings }
			includeLayoutControls
			defaultControls={ DEFAULT_CONTROLS }
		/>
	);
}
