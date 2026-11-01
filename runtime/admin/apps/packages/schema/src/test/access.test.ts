import { deniedBecause, mayAllow } from '../access';

const anon = { id: null, role: null };
const subscriber = { id: 4, role: 'subscriber' };
const editor = { id: 2, role: 'editor' };
const admin = { id: 1, role: 'admin' };

describe( 'mayAllow', () => {
	it( 'answers roles by rank and the two open rules by sign-in', () => {
		expect( mayAllow( 'anyone', anon ) ).toBe( true );
		expect( mayAllow( 'authenticated', anon ) ).toBe( false );
		expect( mayAllow( 'authenticated', subscriber ) ).toBe( true );
		expect( mayAllow( 'editor', subscriber ) ).toBe( false );
		expect( mayAllow( 'editor', editor ) ).toBe( true );
		expect( mayAllow( 'editor', admin ) ).toBe( true );
		expect( mayAllow( 'admin', editor ) ).toBe( false );
	} );

	it( 'lets per-row rules through, since only a request can decide them, and never a denial', () => {
		expect( mayAllow( 'rule', anon ) ).toBe( true );
		expect( mayAllow( 'self', subscriber ) ).toBe( true );
		expect( mayAllow( 'owner', subscriber ) ).toBe( true );
		expect( mayAllow( false, admin ) ).toBe( false );
		expect( mayAllow( undefined, admin ) ).toBe( false );
	} );
} );

describe( 'deniedBecause', () => {
	it( 'names the missing rank for a greyed button and nothing when the rule may allow', () => {
		expect( deniedBecause( 'editor', subscriber ) ).toBe( 'needs editor' );
		expect( deniedBecause( 'authenticated', anon ) ).toBe( 'sign in first' );
		expect( deniedBecause( false, admin ) ).toBe( 'not allowed' );
		expect( deniedBecause( 'rule', subscriber ) ).toBeNull();
		expect( deniedBecause( 'anyone', anon ) ).toBeNull();
	} );
} );
