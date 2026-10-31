import { privateApis as editorPrivateApis } from '@wordpress/editor';
import { __ } from '@wordpress/i18n';
import { unlock } from '@zero-admin/admin-toolkit';
import { useLinkProps } from '@wordpress/route';
import MediaEditorNotices from '../notices';
import MediaEditorHeader from '../header';
import MediaEditorSidebar from '../sidebar';
import MediaEditorCanvas from '../editor-canvas';
import './style.scss';

// Unlock WordPress private APIs
const { InterfaceSkeleton, ComplementaryArea } = unlock(editorPrivateApis);

export default function MediaEditorLayout({
	isPreview,
	editLink,
}: {
	isPreview: boolean;
	editLink: string;
}) {
	const linkProps = useLinkProps({
		to: editLink,
		className: 'zero-admin-site-editor__hyperlink',
	});
	return (
		<div className="zero-admin-site-editor zero-admin-site-editor__media-editor-layout">
				<InterfaceSkeleton
					header={
						!isPreview && (
							<MediaEditorHeader
								backLink={
									editLink.startsWith('/collections/')
										? editLink.slice(0, editLink.lastIndexOf('/'))
										: undefined
								}
							/>
						)
					}
					sidebar={!isPreview && <ComplementaryArea.Slot scope="core/edit-media" />}
					content={<MediaEditorCanvas />}
					secondarySidebar={null}
				/>
				{isPreview && <a {...linkProps} aria-label={__('Edit', 'zero-admin')} />}
				<MediaEditorNotices />
				<MediaEditorSidebar />
			</div>
	);
}
