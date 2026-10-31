export function normalizePageId(
	value: number | string | undefined
): string | null {
	if ( ! value || ! [ 'number', 'string' ].includes( typeof value ) ) {
		return null;
	}

	// We also need to check if it's not zero (`'0'`).
	if ( Number( value ) === 0 ) {
		return null;
	}

	return value.toString();
}

export function getTemplateSlug( postType: string, postSlug?: string ) {
	// In `draft` status we might not have a slug available, so we use the `single`
	// post type templates slug(ex page, single-post, single-product etc..).
	// Pages do not need the `single` prefix in the slug to be prioritized
	// through template hierarchy.
	if ( postSlug ) {
		return postType === 'page'
			? `${ postType }-${ postSlug }`
			: `single-${ postType }-${ postSlug }`;
	}

	return postType === 'page' ? 'page' : `single-${ postType }`;
}

/**
 * Generates a state key for view config storage.
 *
 * @param kind    Entity kind (e.g., 'root', 'postType', 'taxonomy').
 * @param name    Entity name (e.g., 'user', 'post', 'category').
 * @param variant Optional. View config identifier.
 * @return State key string.
 */
export function getViewConfigStateKey(
	kind: string,
	name: string,
	variant?: string | null
): string {
	return variant ? `${ kind }-${ name }-${ variant }` : `${ kind }-${ name }`;
}
