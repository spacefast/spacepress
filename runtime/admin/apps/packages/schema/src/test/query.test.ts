import type { View } from '@zero-admin/dataviews';
import { postQuery, postQueryWithDropped, statusesOf, tableQuery, tableQueryWithDropped, whereOf } from '../query';
import { posts, staff } from '../test-fixtures';

describe( 'tableQuery', () => {
	it( 'maps page, sort, filters and search onto the list route of a table collection', () => {
		const view: View = {
			type: 'table', page: 3, perPage: 25, fields: [ 'name' ],
			sort: { field: 'name', direction: 'desc' },
			filters: [ { field: 'kind', operator: 'isAny', value: [ 'pro' ] }, { field: 'active', operator: 'is', value: true } ],
			search: 'ann',
		};
		const named = { ...staff, title: 'name' };
		const q = tableQuery( view, named );
		expect( q.limit ).toBe( '25' );
		expect( q.offset ).toBe( '50' );
		expect( q.orderBy ).toBe( '-name' );
		expect( JSON.parse( q.where ) ).toEqual( { AND: [ { kind: { in: [ 'pro' ] } }, { active: { eq: true } }, { name: { like: '%ann%' } } ] } );
	} );

	it( 'sends one clause bare, no where at all without filters, and escapes like wildcards in a search', () => {
		expect( tableQuery( { type: 'table', fields: [] }, staff ) ).toEqual( { limit: '20', offset: '0' } );
		const q = tableQuery( { type: 'table', fields: [], search: '50%_off' }, { ...staff, title: 'name' } );
		expect( JSON.parse( q.where ) ).toEqual( { name: { like: '%50\\%\\_off%' } } );
	} );

	it( 'ignores a search when the collection has no title column to search', () => {
		expect( tableQuery( { type: 'table', fields: [], search: 'x' }, staff ).where ).toBeUndefined();
	} );

	it( 'filters a list column by membership and reports a filter it cannot express', () => {
		const tags = { type: 'select' as const, multiple: true, enum: [ 'news', 'guide' ] };
		const q = tableQueryWithDropped( { type: 'table', fields: [], filters: [ { field: 'tags', operator: 'isAny', value: [ 'news', 'guide' ] }, { field: 'tags', operator: 'inThePast', value: 1 } ] }, { ...staff, columns: { ...staff.columns, tags } } );
		expect( JSON.parse( q.query.where ) ).toEqual( { OR: [ { tags: { has: 'news' } }, { tags: { has: 'guide' } } ] } );
		expect( q.droppedFilters ).toEqual( [ 'tags' ] );
	} );
} );

describe( 'whereOf', () => {
	it( 'translates every operator Zero has and refuses the ones it does not', () => {
		expect( whereOf( 'n', 'isNot', 1 ) ).toEqual( { n: { ne: 1 } } );
		expect( whereOf( 'n', 'greaterThanOrEqual', 1 ) ).toEqual( { n: { gte: 1 } } );
		expect( whereOf( 'n', 'between', [ 1, 5 ] ) ).toEqual( { AND: [ { n: { gte: 1 } }, { n: { lte: 5 } } ] } );
		expect( whereOf( 'n', 'startsWith', 'a' ) ).toEqual( { n: { like: 'a%' } } );
		expect( whereOf( 'n', 'isNone', [ 'a' ] ) ).toEqual( { n: { notIn: [ 'a' ] } } );
		expect( whereOf( 'n', 'inThePast', 3 ) ).toBeNull();
		expect( whereOf( 'n', 'isAny', 'not-a-list' ) ).toBeNull();
	} );

	it( 'uses has, never in, on list columns, with NOT for the negative operators', () => {
		const list = { type: 'mediaList' as const };
		expect( whereOf( 'g', 'is', 7, list ) ).toEqual( { g: { has: 7 } } );
		expect( whereOf( 'g', 'isAll', [ 1, 2 ], list ) ).toEqual( { AND: [ { g: { has: 1 } }, { g: { has: 2 } } ] } );
		expect( whereOf( 'g', 'isNone', [ 1, 2 ], list ) ).toEqual( { NOT: { OR: [ { g: { has: 1 } }, { g: { has: 2 } } ] } } );
		expect( whereOf( 'g', 'isNotAll', [ 1, 2 ], list ) ).toEqual( { NOT: { AND: [ { g: { has: 1 } }, { g: { has: 2 } } ] } } );
		expect( whereOf( 'g', 'greaterThan', 1, list ) ).toBeNull();
	} );
} );

describe( 'postQuery', () => {
	it( 'asks core for the edit context, every non-trashed status, and maps Zero statuses and sortable core columns', () => {
		const q = postQuery( { type: 'table', fields: [], page: 2, perPage: 10, sort: { field: 'title', direction: 'asc' }, filters: [ { field: 'status', operator: 'is', value: 'published' } ], search: 'hi' }, posts );
		expect( q ).toEqual( { per_page: 10, page: 2, context: 'edit', status: 'publish', search: 'hi', orderby: 'title', order: 'asc' } );
		expect( postQuery( { type: 'table', fields: [], sort: { field: 'excerpt', direction: 'asc' } }, posts ).orderby ).toBeUndefined();
	} );

	it( 'maps every status operator onto the set of core statuses it allows, and drops a filter core cannot apply', () => {
		expect( statusesOf( { operator: 'isAny', value: [ 'published', 'scheduled' ] } ) ).toEqual( [ 'future', 'publish' ] );
		expect( statusesOf( { operator: 'isNot', value: 'published' } ) ).toEqual( [ 'draft', 'future', 'pending', 'private' ] );
		expect( statusesOf( { operator: 'isNone', value: [ 'draft' ] } ) ).toEqual( [ 'future', 'publish' ] );
		expect( statusesOf( { operator: 'is', value: 'nonsense' } ) ).toBeNull();
		const q = postQueryWithDropped( { type: 'table', fields: [], filters: [ { field: 'status', operator: 'isAny', value: [ 'draft' ] }, { field: 'excerpt', operator: 'contains', value: 'x' } ] }, posts );
		expect( q.query.status ).toBe( 'draft,pending,private' );
		expect( q.droppedFilters ).toEqual( [ 'excerpt' ] );
	} );

	it( 'reports a sort core cannot apply instead of pretending, and sorts by the key through core id', () => {
		expect( postQueryWithDropped( { type: 'table', fields: [], sort: { field: 'excerpt', direction: 'asc' } }, posts ).droppedSort ).toBe( 'excerpt' );
		expect( postQueryWithDropped( { type: 'table', fields: [], sort: { field: 'title', direction: 'asc' } }, posts ).droppedSort ).toBeNull();
		const byId = postQueryWithDropped( { type: 'table', fields: [], sort: { field: 'id', direction: 'desc' } }, posts );
		expect( [ byId.query.orderby, byId.query.order, byId.droppedSort ] ).toEqual( [ 'id', 'desc', null ] );
	} );
} );
