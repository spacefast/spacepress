import { unlock } from '@zero-admin/admin-toolkit';
import { Platform } from '@wordpress/element';
import { isRTL, __ } from '@wordpress/i18n';
import { drawerLeft, drawerRight } from '@wordpress/icons';
import { privateApis as editorPrivateApis } from '@wordpress/editor';
import MediaEditorSidebarDetails from './details';
import './style.scss';

export const MEDIA_EDITOR_SIDEBAR = 'core/edit-media';
export const MEDIA_EDITOR_SIDEBAR_DETAILS_TAB = 'core/edit-media/details';
const SIDEBAR_ACTIVE_BY_DEFAULT = Platform.select( {
	web: true,
} );

const { ComplementaryArea } = unlock( editorPrivateApis );

export default function Sidebar() {
	return (
		<ComplementaryArea
			className="zero-admin-media-editor-sidebar"
			/* translators: button label text should, if possible, be under 16 characters. */
			title={ __( 'Details', 'zero-admin' ) }
			closeLabel={ __( 'Close details', 'zero-admin' ) }
			scope={ MEDIA_EDITOR_SIDEBAR }
			identifier={ MEDIA_EDITOR_SIDEBAR_DETAILS_TAB }
			icon={ isRTL() ? drawerLeft : drawerRight }
			isActiveByDefault={ SIDEBAR_ACTIVE_BY_DEFAULT }
		>
			<div className="zero-admin-media-editor-sidebar__tabs-panel">
				<MediaEditorSidebarDetails />
			</div>
		</ComplementaryArea>
	);
}
