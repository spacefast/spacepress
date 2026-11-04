import { useFieldCollections } from '@zero-admin/core-data-next';
import type { Theme } from '@wordpress/core-data';
import type { Field } from '@zero-admin/dataviews';
import { useMemo } from '@wordpress/element';
import { decodeEntities } from '@wordpress/html-entities';
import { __ } from '@wordpress/i18n';

function extractTagsFromTheme( theme: Theme ): string[] {
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

/**
 * Hook that generates theme fields for the themes DataView.
 *
 * Creates field configurations for displaying theme information
 * including name, screenshot, tags, description, author, version, and active status.
 *
 * @param themes Array of theme data to extract available tags from
 * @return Array of theme field configurations for DataViews
 */
export function useThemeFields( themes?: Theme[] ): Field< Theme >[] {
	// Extract unique tags from all themes for the tags field elements
	const tagElements = useMemo( () => {
		if ( ! themes || themes.length === 0 ) {
			return [];
		}

		const allTags = new Set(
			themes.flatMap( ( theme ) => extractTagsFromTheme( theme ) )
		);

		return Array.from( allTags )
			.filter( Boolean )
			.sort()
			.map( ( tag ) => ( {
				value: tag,
				label: tag,
			} ) );
	}, [ themes ] );

	// Extract unique authors from all themes for the author field elements
	const authorElements = useMemo( () => {
		if ( ! themes || themes.length === 0 ) {
			return [];
		}

		const allAuthors = new Set< string >();
		themes.forEach( ( theme ) => {
			const author = theme?.author?.raw;
			if ( author && typeof author === 'string' ) {
				const decodedAuthor = decodeEntities( author );
				allAuthors.add( decodedAuthor );
			} else if ( author === '' ) {
				allAuthors.add( __( 'Anonymous', 'zero-admin' ) );
			}
		} );

		return Array.from( allAuthors )
			.sort()
			.map( ( author ) => ( {
				value: author,
				label: author,
			} ) );
	}, [ themes ] );

	const fields = useFieldCollections( 'root', 'theme' );

	return useMemo( () => {
		return ( fields ?? [] ).map( ( field ) => {
			if ( field.id === 'tags' ) {
				return {
					...field,
					elements: tagElements,
				};
			}
			if ( field.id === 'author' ) {
				return {
					...field,
					elements: authorElements,
				};
			}
			return field;
		} );
	}, [ fields, tagElements, authorElements ] );
}
