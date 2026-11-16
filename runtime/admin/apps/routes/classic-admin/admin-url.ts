/**
 * The classic route frames pages of this site's wp-admin and nothing else.
 * `adminBase` is `admin_url()` as the page handed it in: absolute, ending in `/`.
 */

/** True when `href` is a page under `adminBase` on the same origin. */
export function isUnderAdmin( href: string, adminBase: string ): boolean {
	let url: URL;
	try {
		url = new URL( href, adminBase );
	} catch {
		return false;
	}
	return url.origin === new URL( adminBase ).origin && url.href.startsWith( adminBase );
}

/**
 * The URL to frame for a route slug (`options-media.php`, `edit.php?post_type=page`).
 * Anything that would leave wp-admin (another origin, a `javascript:` or `data:`
 * URL, a path above wp-admin) falls back to the admin index.
 */
export function resolveAdminUrl( slug: string, adminBase: string ): string {
	if ( ! isUnderAdmin( slug, adminBase ) ) {
		return adminBase;
	}
	return new URL( slug, adminBase ).href;
}

/** The route slug for a framed URL, or null when the URL is not a wp-admin page. */
export function slugOf( href: string, adminBase: string ): string | null {
	return isUnderAdmin( href, adminBase ) ? href.slice( adminBase.length ) : null;
}
