import { __ } from '@wordpress/i18n';
// @ts-expect-error - WordPress private APIs
import { privateApis as blockEditorPrivateApis } from '@wordpress/block-editor';
import { unlock } from '@zero-admin/admin-toolkit';
import type { GlobalStylesSettings } from '@zero-admin/global-styles-engine';
import { ScreenHeader } from './screen-header';
import DimensionsPanel from './dimensions-panel';
import { useSetting } from './hooks';

const { useHasDimensionsPanel, useSettingsForBlockElement } = unlock(
	blockEditorPrivateApis
);

function ScreenLayout() {
	const [ rawSettings ] = useSetting< GlobalStylesSettings >( '' );
	const settings = useSettingsForBlockElement( rawSettings );
	const hasDimensionsPanel = useHasDimensionsPanel( settings );

	return (
		<>
			<ScreenHeader title={ __( 'Layout', 'zero-admin' ) } />
			{ hasDimensionsPanel && <DimensionsPanel /> }
		</>
	);
}

export default ScreenLayout;
