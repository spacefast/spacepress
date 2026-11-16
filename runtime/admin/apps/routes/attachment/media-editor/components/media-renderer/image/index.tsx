import { MediaLoading } from '../../../../../../packages/boot/src/media-loading';
import { useMediaResource } from '../../../../../../packages/boot/src/use-media-url';
import type { MediaItem } from '../../../types';
import ImagePreview from './preview';
import ImageCropper from './editing-tools/image-cropper';
import { useMediaEditorState } from '../../../provider/with-media-editor-state-provider';

export default function ImageRenderer( { post }: { post: MediaItem } ) {
	const { isImageEditorOpen, isEditInProgress } = useMediaEditorState();
	const resource = useMediaResource( post?.id, post?.source_url, post?.modified );
	const displayUrl = resource.kind === 'ready' ? resource.url : undefined;

	if ( resource.kind !== 'ready' ) return <MediaLoading resource={ resource } />;
	if ( ! post ) {
		return null;
	}

	if (isEditInProgress) return null;
	return isImageEditorOpen
		? <ImageCropper src={displayUrl ?? ''} />
		: <ImagePreview sourceUrl={ displayUrl ?? '' } altText={ post.alt_text } />;
}
