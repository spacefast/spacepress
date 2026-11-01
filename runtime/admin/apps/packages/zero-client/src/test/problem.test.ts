import { problemOf } from '../problem';
import { paginationOf } from '../pagination';
import { contextOf } from '../context';

describe( 'problemOf', () => {
	it( 'reads a Zero problem document with its pointer as the field', () => {
		expect( problemOf( { status: 403, code: 'forbidden', title: 'Forbidden', detail: "You don't have access to update payroll.salary", pointer: '/salary' } ) )
			.toEqual( { status: 403, code: 'forbidden', message: "You don't have access to update payroll.salary", field: 'salary' } );
	} );

	it( 'reads a core REST error the way apiFetch throws it, with the pointer the runtime adds to its data', () => {
		expect( problemOf( { code: 'forbidden', message: 'No', data: { status: 403, pointer: '/acf/zero_salary' } } ) )
			.toEqual( { status: 403, code: 'forbidden', message: 'No', field: 'acf/zero_salary' } );
	} );

	it( 'never throws on a transport failure', () => {
		expect( problemOf( new TypeError( 'fetch failed' ) ) ).toEqual( { status: 0, code: 'error', message: 'fetch failed', field: null } );
		expect( problemOf( undefined ).code ).toBe( 'error' );
	} );
} );

describe( 'paginationOf', () => {
	it( 'promises one more page while the last page was full and stops when it was not', () => {
		expect( paginationOf( 1, 20, 20 ) ).toEqual( { totalItems: 21, totalPages: 2 } );
		expect( paginationOf( 2, 20, 7 ) ).toEqual( { totalItems: 27, totalPages: 2 } );
		expect( paginationOf( 1, 20, 0 ) ).toEqual( { totalItems: 0, totalPages: 1 } );
	} );
} );

describe( 'contextOf', () => {
	it( 'reads the schema, permits and viewer the page handed in and defaults what is missing', () => {
		expect( contextOf( undefined ).schema ).toBeNull();
		const c = contextOf( { schema: { name: 'blog', collections: {}, globals: {}, actions: {} }, permits: { collections: { posts: true } }, viewer: { id: 2, role: 'editor' } } );
		expect( c.schema?.name ).toBe( 'blog' );
		expect( c.permits ).toEqual( { collections: { posts: true }, globals: {} } );
		expect( c.viewer ).toEqual( { id: 2, role: 'editor' } );
		expect( contextOf( { viewer: { id: '2' } } ).viewer ).toEqual( { id: null, role: null } );
		expect( contextOf( { site_time: { timezone: 'Europe/Berlin', gmt_offset: 1 } } ).siteTime ).toEqual( { timezone: 'Europe/Berlin', gmtOffset: 1 } );
		expect( contextOf( { site_time: { timezone: '', gmt_offset: -5.5 } } ).siteTime ).toEqual( { timezone: null, gmtOffset: -5.5 } );
	} );
} );
