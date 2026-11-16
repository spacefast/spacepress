import { __ } from '@wordpress/i18n';
// @ts-expect-error - WordPress private APIs
import { privateApis as blockEditorPrivateApis } from '@wordpress/block-editor';
import { __experimentalText as Text } from '@wordpress/components';
import { unlock } from '@typedpress-admin/admin-toolkit';
import BackgroundPanel from './background-panel';
import { ScreenHeader } from './screen-header';
import { useSetting } from './hooks';

const { useHasBackgroundPanel } = unlock( blockEditorPrivateApis );

function ScreenBackground() {
	const [ settings ] = useSetting( '' );
	const hasBackgroundPanel = useHasBackgroundPanel( settings );
	return (
		<>
			<ScreenHeader
				title={ __( 'Background', 'typedpress-admin' ) }
				description={
					<Text>
						{ __(
							"Set styles for the site's background.",
							'typedpress-admin'
						) }
					</Text>
				}
			/>
			{ hasBackgroundPanel && <BackgroundPanel /> }
		</>
	);
}

export default ScreenBackground;
