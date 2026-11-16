/**
 * Which history the router runs on. Under the mount path (`/blog/wp-admin/new/media`)
 * the browser's own history carries the route; anywhere else (`wp-admin/admin.php?page=typedpress-admin`,
 * which every server serves) the route travels in a `p` query parameter.
 */
export function historyKind(
	pathname: string,
	mountPath: string
): 'browser' | 'query' {
	return pathname === mountPath || pathname.startsWith( `${ mountPath }/` )
		? 'browser'
		: 'query';
}
