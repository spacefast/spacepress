import { MediaLoading } from '../../../../../../packages/boot/src/media-loading';
import { useMediaResource } from '../../../../../../packages/boot/src/use-media-url';
import type { MediaItem } from '../../../types';
import ImagePreview from './preview';

export default function ImageRenderer( { post }: { post: MediaItem } ) {
	const resource = useMediaResource( post?.id, post?.source_url, post?.modified );
	const displayUrl = resource.kind === 'ready' ? resource.url : undefined;

	if ( resource.kind !== 'ready' ) return <MediaLoading resource={ resource } />;
	if ( ! post ) {
		return null;
	}

	return <ImagePreview sourceUrl={ displayUrl ?? '' } altText={ post.alt_text } />;
}
