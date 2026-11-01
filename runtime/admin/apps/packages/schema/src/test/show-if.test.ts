import { isShown } from '../show-if';

describe( 'isShown', () => {
	it( 'treats a scalar as equality and ANDs siblings', () => {
		expect( isShown( { kind: 'pro' }, { kind: 'pro' } ) ).toBe( true );
		expect( isShown( { kind: 'pro' }, { kind: 'basic' } ) ).toBe( false );
		expect( isShown( { status: 'published', kind: 'pro' }, { status: 'published', kind: 'pro' } ) ).toBe( true );
		expect( isShown( { status: 'published', kind: 'pro' }, { status: 'draft', kind: 'pro' } ) ).toBe( false );
	} );

	it( 'supports eq, ne, in, isNull and isNotNull', () => {
		expect( isShown( { kind: { eq: 'pro' } }, { kind: 'pro' } ) ).toBe( true );
		expect( isShown( { kind: { ne: 'pro' } }, { kind: 'pro' } ) ).toBe( false );
		expect( isShown( { kind: { in: [ 'basic', 'pro' ] } }, { kind: 'basic' } ) ).toBe( true );
		expect( isShown( { kind: { in: [ 'basic', 'pro' ] } }, { kind: 'enterprise' } ) ).toBe( false );
		expect( isShown( { plan: { isNull: true } }, {} ) ).toBe( true );
		expect( isShown( { plan: { isNotNull: true } }, { plan: 'x' } ) ).toBe( true );
		expect( isShown( { plan: { isNotNull: true } }, { plan: null } ) ).toBe( false );
	} );

	it( 'ORs alternatives, and ANDs the OR with the siblings beside it, as the runtime does', () => {
		const rule = { OR: [ { kind: { in: [ 'basic', 'pro' ] } }, { active: true } ] };
		expect( isShown( rule, { kind: 'enterprise', active: true } ) ).toBe( true );
		expect( isShown( rule, { kind: 'basic', active: false } ) ).toBe( true );
		expect( isShown( rule, { kind: 'enterprise', active: false } ) ).toBe( false );
		const conjoined = { status: 'published', OR: [ { kind: 'pro' }, { active: true } ] };
		expect( isShown( conjoined, { status: 'draft', kind: 'pro' } ) ).toBe( false );
		expect( isShown( conjoined, { status: 'published', kind: 'pro' } ) ).toBe( true );
	} );

	it( 'ANDs several operators on one sibling', () => {
		expect( isShown( { kind: { ne: 'basic', isNotNull: true } }, { kind: 'pro' } ) ).toBe( true );
		expect( isShown( { kind: { ne: 'basic', isNotNull: true } }, { kind: 'basic' } ) ).toBe( false );
		expect( isShown( { kind: { ne: 'basic', isNotNull: true } }, {} ) ).toBe( false );
	} );

	it( 'treats the empty string and the empty list as empty, like the runtime', () => {
		expect( isShown( { plan: { isNull: true } }, { plan: '' } ) ).toBe( true );
		expect( isShown( { plan: { isNotNull: true } }, { plan: [] } ) ).toBe( false );
		expect( isShown( { plan: null }, { plan: '' } ) ).toBe( true );
	} );

	it( 'compares booleans and numbers by meaning, as stored values come back as 0/1 and strings', () => {
		expect( isShown( { active: true }, { active: 1 } ) ).toBe( true );
		expect( isShown( { active: true }, { active: '1' } ) ).toBe( true );
		expect( isShown( { seats: 3 }, { seats: '3' } ) ).toBe( true );
		expect( isShown( { active: false }, { active: 0 } ) ).toBe( true );
	} );

	it( 'shows a column with no rule, and hides one whose sibling the row does not carry', () => {
		expect( isShown( undefined, {} ) ).toBe( true );
		expect( isShown( { kind: 'pro' }, {} ) ).toBe( false );
	} );
} );
