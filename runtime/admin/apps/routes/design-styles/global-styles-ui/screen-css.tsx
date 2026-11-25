import { __ } from '@wordpress/i18n';
import { Link } from '@wordpress/ui';
// @ts-expect-error - WordPress private APIs
import { privateApis as blockEditorPrivateApis } from '@wordpress/block-editor';
import { unlock } from '@spacepress-admin/admin-toolkit';
import { ScreenHeader } from './screen-header';
import { useStyle } from './hooks';

// Access AdvancedPanel from block-editor private APIs
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- unlock() returns untyped private APIs
const { AdvancedPanel: StylesAdvancedPanel } = unlock( blockEditorPrivateApis );

function ScreenCSS() {
	const description = __(
		'Add your own CSS to customize the appearance and layout of your site.',
		'spacepress-admin'
	);

	// Get user-only styles (should not decode/encode to preserve raw CSS)
	const [ style ] = useStyle< string | undefined >(
		'',
		undefined,
		'user',
		false
	);
	// Get all styles (inherited + user) for context
	const [ inheritedStyle, setStyle ] = useStyle< string | undefined >(
		'',
		undefined,
		'merged',
		false
	);

	return (
		<>
			<ScreenHeader
				title={ __( 'CSS', 'spacepress-admin' ) }
				description={ description }
			/>
			<div className="spacepress-admin-global-styles-screen-css">
				<Link
					href={ __(
						'https://developer.wordpress.org/advanced-administration/wordpress/css/',
						'spacepress-admin'
					) }
					openInNewTab
					className="spacepress-admin-global-styles-screen-css-help-link"
				>
					{ __( 'Learn more about CSS', 'spacepress-admin' ) }
				</Link>
				<StylesAdvancedPanel
					value={ style }
					onChange={ setStyle }
					inheritedValue={ inheritedStyle }
				/>
			</div>
		</>
	);
}

export default ScreenCSS;
