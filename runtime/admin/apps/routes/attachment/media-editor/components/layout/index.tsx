import { privateApis as editorPrivateApis } from '@wordpress/editor';
import { useViewportMatch } from '@wordpress/compose';
import { __ } from '@wordpress/i18n';
import { unlock } from '@spacepress-admin/admin-toolkit';
import { useLinkProps } from '@wordpress/route';
import { ImageCropperProvider } from '@spacepress-admin/image-cropper';
import MediaEditorNotices from '../notices';
import MediaEditorHeader from '../header';
import MediaEditorSidebar from '../sidebar';
import MediaEditorCanvas from '../editor-canvas';
import { EditingToolsToolbar } from '../media-renderer/image/editing-tools';
import { useMediaEditorState } from '../../provider/with-media-editor-state-provider';
import './style.scss';

// Unlock WordPress private APIs
const { InterfaceSkeleton, ComplementaryArea } = unlock( editorPrivateApis );

export default function MediaEditorLayout( {
	isPreview,
	editLink,
}: {
	isPreview: boolean;
	editLink: string;
} ) {
	const linkProps = useLinkProps( {
		to: editLink,
		className: 'spacepress-admin-site-editor__hyperlink',
	} );
	const isMobileViewport = useViewportMatch( 'medium', '<' );
	const { isImageEditorOpen } = useMediaEditorState();
	const isMobileImageEditorOpen = isMobileViewport && isImageEditorOpen;

	return (
		<ImageCropperProvider>
			<div className="spacepress-admin-site-editor spacepress-admin-site-editor__media-editor-layout">
				<InterfaceSkeleton
					header={ ! isPreview && <MediaEditorHeader /> }
					sidebar={
						! isPreview && (
							<ComplementaryArea.Slot scope="core/edit-media" />
						)
					}
					content={
						<>
							{ isMobileImageEditorOpen && (
								<EditingToolsToolbar />
							) }
							<MediaEditorCanvas />
						</>
					}
					secondarySidebar={ null }
				/>
				{ isPreview && (
					<a
						{ ...linkProps }
						aria-label={ __( 'Edit', 'spacepress-admin' ) }
					/>
				) }
				<MediaEditorNotices />
				<MediaEditorSidebar />
			</div>
		</ImageCropperProvider>
	);
}
