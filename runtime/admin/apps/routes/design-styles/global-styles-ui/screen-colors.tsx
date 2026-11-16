import { __ } from '@wordpress/i18n';
import { __experimentalVStack as VStack } from '@wordpress/components';
// @ts-expect-error - WordPress private APIs
import { privateApis as blockEditorPrivateApis } from '@wordpress/block-editor';
import type {
	GlobalStylesStyles,
	GlobalStylesSettings,
} from '@typedpress-admin/global-styles-engine';
import { unlock } from '@typedpress-admin/admin-toolkit';
import { ScreenHeader } from './screen-header';
import Palette from './palette';
import { useStyle, useSetting } from './hooks';

const { useSettingsForBlockElement, ColorPanel: StylesColorPanel } = unlock(
	blockEditorPrivateApis
);

function ScreenColors() {
	// Get user styles for editing
	const [ style, setStyle ] = useStyle< GlobalStylesStyles >(
		'',
		undefined,
		'user',
		false
	);
	// Get inherited styles for display
	const [ inheritedStyle ] = useStyle< GlobalStylesStyles >(
		'',
		undefined,
		'merged',
		false
	);
	// Get settings for the color panel
	const [ rawSettings ] = useSetting< GlobalStylesSettings >( '' );
	const settings = useSettingsForBlockElement( rawSettings );

	return (
		<>
			<ScreenHeader
				title={ __( 'Colors', 'typedpress-admin' ) }
				description={ __(
					'Palette colors and the application of those colors on site elements.',
					'typedpress-admin'
				) }
			/>
			<div className="typedpress-admin-global-styles-screen">
				<VStack spacing={ 7 }>
					<Palette />
					<StylesColorPanel
						inheritedValue={ inheritedStyle }
						value={ style }
						onChange={ setStyle }
						settings={ settings }
					/>
				</VStack>
			</div>
		</>
	);
}

export default ScreenColors;
