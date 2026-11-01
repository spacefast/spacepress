import { SiteIconBackButton, unlock } from '@zero-admin/admin-toolkit';
import { useSelect } from '@wordpress/data';
import { privateApis as editorPrivateApis } from '@wordpress/editor';
import { store as coreStore, useEntityId } from '@wordpress/core-data';
import { useViewportMatch } from '@wordpress/compose';
import MediaEditorSaveButton from '../save-button';
import DocumentBar from '../document-bar';
import { getMediaTypeFromMimeType } from '../../utils';
import type { MediaItemUpdatable } from '../../types';

const { PinnedItems } = unlock(editorPrivateApis);

export default function MediaEditorHeader({
	backLink = '/media',
}: {
	backLink?: string;
}) {
	const postId = useEntityId('postType', 'attachment');
	const isMobileViewport = useViewportMatch('medium', '<');
	const post = useSelect(
		(select) => select(coreStore).getEditedEntityRecord('postType', 'attachment', postId),
		[postId],
	) as MediaItemUpdatable;

	if (!post) {
		return null;
	}

	const mediaType = getMediaTypeFromMimeType(post?.mime_type || '');

	return (
		<div className="zero-admin-media-details__header-container">
			<div className="zero-admin-media-details__header-container-back-button">
				<SiteIconBackButton to={backLink} />
			</div>
			<div className="zero-admin-media-details__header-container-center">
				{!isMobileViewport && <DocumentBar title={post?.title} icon={mediaType.icon} />}
			</div>
			<div className="zero-admin-media-details__header-container-actions">
				<PinnedItems.Slot scope="core/edit-media" />
				<MediaEditorSaveButton postId={postId} />
			</div>
		</div>
	);
}
