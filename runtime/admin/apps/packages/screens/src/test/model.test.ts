import { actionInput, at, display, items, readPath, sorted } from '../model';

describe( 'screen declarations', () => {
	it( 'reads the items at the declared path, and refuses an output without them', () => {
		const view = { ability: 'blog/schema-read', items: 'versions', fields: [] };
		expect( items( view, { versions: [ { version: 1 }, null, { version: 2 } ] } ) ).toEqual( [
			{ version: 1 },
			{ version: 2 },
		] );
		expect( items( { ...view, items: undefined }, [ { id: 'a' } ] ) ).toEqual( [ { id: 'a' } ] );
		expect( () => items( view, { rows: [] } ) ).toThrow( 'no list at "versions"' );
	} );

	it( 'fills {item.x} placeholders and keeps their types; other strings stay as written', () => {
		const action = {
			id: 'approve',
			label: 'Approve',
			ability: 'blog/comments-update',
			input: { id: '{item.id}', patch: { approved: true, note: 'by {item.id}' }, tags: [ '{item.meta.tag}' ] },
		};
		expect( actionInput( action, { id: 7, meta: { tag: 'x' } } ) ).toEqual( {
			id: 7,
			patch: { approved: true, note: 'by {item.id}' },
			tags: [ 'x' ],
		} );
	} );

	it( 'puts a read-only ability input in the query, as core run route reads GET input', () => {
		expect( readPath( { ability: 'a/b', fields: [] } ) ).toBe( '/wp-abilities/v1/abilities/a/b/run' );
		expect( decodeURIComponent( readPath( { ability: 'a/b', input: { limit: 5, where: { approved: false } }, fields: [] } ) ) ).toBe(
			'/wp-abilities/v1/abilities/a/b/run?input[limit]=5&input[where][approved]=false'
		);
	} );

	it( 'sorts numbers as numbers, newest first when the view says desc', () => {
		const rows = [ { version: 2 }, { version: 10 }, { version: 1 } ];
		expect( sorted( rows, { field: 'version', direction: 'desc' } ).map( ( r ) => r.version ) ).toEqual( [ 10, 2, 1 ] );
		expect( sorted( rows ) ).toBe( rows );
	} );

	it( 'reads dot paths and shows values as text', () => {
		expect( at( { a: { b: 1 } }, 'a.b' ) ).toBe( 1 );
		expect( at( { a: 1 }, 'a.b' ) ).toBeUndefined();
		expect( display( [ 'one', 'two' ] ) ).toBe( 'one\ntwo' );
		expect( display( null ) ).toBe( '—' );
	} );
} );
