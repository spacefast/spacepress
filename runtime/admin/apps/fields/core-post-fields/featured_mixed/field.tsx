import { MediaLoading } from '../../../packages/boot/src/media-loading';
import { useMediaResource } from '../../../packages/boot/src/use-media-url';
import { renderedText } from '../../../packages/boot/src/rendered-text';
import type { Attachment, Post } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import type { Field, DataViewRenderFieldProps } from '@zero-admin/dataviews';
import './style.scss';

function FeaturedMixed({ item }: DataViewRenderFieldProps<Post>) {
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
		return <img className="fields-controls__featured-image-image" src={url} alt="" />;
	}

	return (
		<div className="dataviews-media-field__featured-mixed">
			<p>
				{renderedText(
					typeof item.excerpt === 'string' ? item.excerpt : (item.excerpt?.rendered ?? ''),
				)}
			</p>
		</div>
	);
}

export const fieldExtensions: Partial<Field<Post>> = {
	render: FeaturedMixed,
};
