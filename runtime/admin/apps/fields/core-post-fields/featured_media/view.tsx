import { MediaLoading } from '../../../packages/boot/src/media-loading';
import { useMediaResource } from '../../../packages/boot/src/use-media-url';
import { useSelect } from '@wordpress/data';
import { type Attachment, store as coreStore, type Post } from '@wordpress/core-data';
import type { DataViewRenderFieldProps } from '@zero-admin/dataviews';

export const FeaturedImageView = ({ item, config }: DataViewRenderFieldProps<Post>) => {
	const mediaId = item.featured_media;

	const media = useSelect(
		(select) => {
			const { getEntityRecord } = select(coreStore);
			return mediaId ? getEntityRecord<Attachment>('postType', 'attachment', mediaId) : null;
		},
		[mediaId],
	);
	const resource = useMediaResource(media?.id, media?.source_url, media?.modified);
	const url = resource.kind === 'ready' ? resource.url : undefined;

	if (resource.kind !== 'ready') return <MediaLoading resource={resource} />;
	if (url) {
		return (
			<img
				className="fields-controls__featured-image-image"
				src={url}
				alt=""
				srcSet={
					media?.media_details?.sizes
						? Object.values(media.media_details.sizes)
								.map((size: any) => `${size.source_url} ${size.width}w`)
								.join(', ')
						: undefined
				}
				sizes={config?.sizes || '100vw'}
			/>
		);
	}

	return <span className="fields-controls__featured-image-placeholder" />;
};
