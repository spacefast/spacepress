import type { Theme } from '@wordpress/core-data';

/**
 * Extracts tags from a theme object, handling various tag data formats.
 *
 * @param theme Theme object to extract tags from
 * @return Array of tag strings
 */
export function extractTagsFromTheme( theme: Theme ): string[] {
	const tags = theme.tags?.raw || theme.tags;
	if ( Array.isArray( tags ) ) {
		return tags.filter( ( tag ) => typeof tag === 'string' );
	}
	if ( typeof tags === 'string' ) {
		return [ tags ];
	}
	// Handle sparse array-like objects (e.g., {0:'foo', 2:'bar'})
	if ( tags && typeof tags === 'object' ) {
		return Object.values( tags ).filter(
			( tag ) => typeof tag === 'string'
		);
	}
	return [];
}
