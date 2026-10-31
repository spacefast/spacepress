import type { Attachment, Updatable, Post } from '@wordpress/core-data';

export type MediaKind = 'image' | 'video' | 'audio' | 'application';

export interface MediaType {
	type: MediaKind;
	label: string;
	icon: JSX.Element;
}

export interface MediaItem extends Attachment< 'edit' > {
	// featured_media is not in the Attachment type. See https://github.com/WordPress/gutenberg/blob/trunk/packages/core-data/src/entity-types/attachment.ts#L10
	featured_media: number;
	_embedded?: {
		'wp:attached-to'?: Post[] | Partial< Post >[];
	};
}

export type MediaItemUpdatable = Updatable< Attachment >;
