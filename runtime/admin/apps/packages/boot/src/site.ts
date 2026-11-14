/**
 * Where this admin lives on the site. The page hands these in at boot from
 * `site_url()` and `admin_url()`, so a WordPress installed below the origin
 * root (`/blog/`) or with a relocated wp-admin still routes and frames
 * correctly. The defaults only serve code that runs before `init()`.
 */
export interface SiteConfig {
	/** The app's mount path, without a trailing slash: `/wp-admin/new` or `/blog/wp-admin/new`. */
	mountPath: string;
	/** `admin_url()`: an absolute URL ending in `/`. */
	adminUrl: string;
}

let config: SiteConfig | undefined;

function defaults(): SiteConfig {
	return {
		mountPath: '/wp-admin/new',
		adminUrl: `${ window.location.origin }/wp-admin/`,
	};
}

/** Normalize the page's `mount_url` to the pathname the router mounts at. */
export function mountPathOf( mountUrl: string ): string {
	const path = new URL( mountUrl, window.location.origin ).pathname;
	return path.length > 1 ? path.replace( /\/+$/, '' ) : '/';
}

export function configureSite( context: {
	mount_url?: unknown;
	admin_url?: unknown;
} ): void {
	const next = defaults();
	if ( typeof context.mount_url === 'string' && context.mount_url ) {
		next.mountPath = mountPathOf( context.mount_url );
	}
	if ( typeof context.admin_url === 'string' && context.admin_url ) {
		const url = new URL( context.admin_url, window.location.origin );
		next.adminUrl = url.href.endsWith( '/' ) ? url.href : `${ url.href }/`;
	}
	config = next;
}

export function siteConfig(): SiteConfig {
	return config ?? defaults();
}
