/**
 * Which history the router runs on. Under the mount path (`/blog/zero-admin/media`)
 * the browser's own history carries the route; anywhere else (the wp-admin
 * redirect page) the route travels in a `p` query parameter.
 */
export function historyKind(
	pathname: string,
	mountPath: string
): 'browser' | 'query' {
	return pathname === mountPath || pathname.startsWith( `${ mountPath }/` )
		? 'browser'
		: 'query';
}
