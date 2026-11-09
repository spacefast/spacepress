import { __ } from '@wordpress/i18n';
import { audio, video, image, file } from '@wordpress/icons';
import type { MediaType } from '../types';

/**
 * Get the media type from a mime type, including an icon.
 * TODO - media types should be formalized somewhere.
 *
 * References:
 * https://developer.wordpress.org/reference/functions/wp_mime_type_icon/
 * https://developer.wordpress.org/reference/hooks/mime_types/
 * https://developer.wordpress.org/reference/functions/wp_get_mime_types/
 *
 * @param mimeType - The mime type to get the media type from.
 * @return The media type.
 */
export function getMediaTypeFromMimeType( mimeType: string ): MediaType {
	if ( mimeType.startsWith( 'image/' ) ) {
		return {
			type: 'image',
			label: __( 'Image', 'first-admin' ),
			icon: image,
		};
	}

	if ( mimeType.startsWith( 'video/' ) ) {
		return {
			type: 'video',
			label: __( 'Video', 'first-admin' ),
			icon: video,
		};
	}

	if ( mimeType.startsWith( 'audio/' ) ) {
		return {
			type: 'audio',
			label: __( 'Audio', 'first-admin' ),
			icon: audio,
		};
	}

	return {
		type: 'application',
		label: __( 'Application', 'first-admin' ),
		icon: file,
	};
}
