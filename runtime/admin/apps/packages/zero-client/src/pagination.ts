/**
 * `/zero/v1/<c>` lists carry no total. A page that came back full may have a next page; one that
 * did not is the last. DataViews needs totals, so report what is known: the rows seen so far plus
 * one more page while the last page was full.
 */
export function paginationOf( page: number, perPage: number, received: number ): { totalItems: number; totalPages: number } {
	const seen = ( page - 1 ) * perPage + received;
	const more = received >= perPage;
	return { totalItems: more ? seen + 1 : seen, totalPages: more ? page + 1 : Math.max( page, 1 ) };
}
