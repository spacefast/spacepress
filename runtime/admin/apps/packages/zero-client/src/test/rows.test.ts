import { changedOnly, forCreate } from '../rows';

describe( 'changedOnly', () => {
	it( 'keeps only the keys whose value changed, comparing structured values by content', () => {
		expect( changedOnly( { a: 1, b: 'x', c: { d: 1 } }, { a: 1, b: 'y', c: { d: 1 } } ) ).toEqual( { b: 'y' } );
		expect( changedOnly( { a: 1 }, { a: 1, e: null } ) ).toEqual( {}, 'absent and null are the same stored value' );
		expect( changedOnly( { a: 1 }, { a: 1, e: 'x' } ) ).toEqual( { e: 'x' } );
		expect( changedOnly( { tags: [ 'a' ] }, { tags: [ 'a', 'b' ] } ) ).toEqual( { tags: [ 'a', 'b' ] } );
	} );

	it( 'sends an explicit null for a cleared control, so the save does not silently keep the old value', () => {
		expect( changedOnly( { seats: 3 }, { seats: undefined } ) ).toEqual( { seats: null } );
		expect( changedOnly( { seats: null }, { seats: undefined } ) ).toEqual( {} );
		expect( forCreate( { name: 'x', seats: undefined } ) ).toEqual( { name: 'x', seats: null } );
	} );
} );
