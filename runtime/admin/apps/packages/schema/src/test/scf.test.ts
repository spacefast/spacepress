import { fromScf, fromSiteTime, toScf, toSiteTime, unclearable, unknownMember } from '../scf';
import type { DescribedColumn } from '../types';

const seo: DescribedColumn = { type: 'group', fields: { metaTitle: { type: 'text' }, noindex: { type: 'boolean' }, when: { type: 'date' }, extra: { type: 'json' } } };
const sections: DescribedColumn = { type: 'blocks', layouts: { hero: { heading: { type: 'text' }, image: { type: 'media' } }, quote: { text: { type: 'text' } } } };

describe( 'toScf', () => {
	it( 'encodes the scalar kinds the way the runtime stores them for SCF', () => {
		expect( toScf( { type: 'boolean' }, false ) ).toBe( 0 );
		expect( toScf( { type: 'date' }, '2026-02-01' ) ).toBe( '20260201' );
		expect( toScf( { type: 'timestamp' }, '2026-02-01T10:30:00.000Z' ) ).toBe( '2026-02-01 10:30:00' );
		expect( toScf( { type: 'timestamp' }, '2026-02-01T10:30:00.000Z', { timezone: 'Europe/Berlin', gmtOffset: 1 } ) ).toBe( '2026-02-01 11:30:00' );
		expect( toScf( { type: 'timestamp' }, '2026-07-01T10:30:00.000Z', { timezone: 'Europe/Berlin', gmtOffset: 1 } ) ).toBe( '2026-07-01 12:30:00' );
		expect( toScf( { type: 'timestamp' }, '2026-02-01T10:30:00.000Z', { timezone: null, gmtOffset: -5.5 } ) ).toBe( '2026-02-01 05:00:00' );
		expect( toScf( { type: 'json' }, { a: 2 } ) ).toBe( '{"a":2}' );
		expect( toScf( { type: 'json' }, 'hello' ) ).toBe( '"hello"' );
		expect( toScf( { type: 'mediaList' }, [ '7', 8 ] ) ).toEqual( [ 7, 8 ] );
		expect( toScf( { type: 'text' }, null ) ).toBeNull();
	} );

	it( 'nests groups, repeaters and blocks, converting inside and naming the block layout for SCF', () => {
		expect( toScf( seo, { metaTitle: 'T', noindex: true, when: '2026-02-01', extra: { b: 1 } } ) ).toEqual( { metaTitle: 'T', noindex: 1, when: '20260201', extra: '{"b":1}' } );
		// With the column's field key, members travel by their SCF field keys, which the updaters look up first.
		expect( toScf( seo, { metaTitle: 'T', noindex: true }, undefined, 'field_zero_posts_seo' ) ).toEqual( { field_zero_posts_seo_metaTitle: 'T', field_zero_posts_seo_noindex: 1, field_zero_posts_seo_when: '', field_zero_posts_seo_extra: '' } );
		expect( toScf( sections, [ { layout: 'hero', heading: 'H' } ], undefined, 'field_zero_posts_sections' ) ).toEqual( [ { field_zero_posts_sections_hero_heading: 'H', acf_fc_layout: 'hero' } ] );
		expect( toScf( seo, { metaTitle: null, when: null, extra: null } ) ).toEqual( { metaTitle: '', when: '', extra: '' }, "a cleared string-like sub-field is sent as '': SCF's group updater applies it (it skips null) and the runtime reads it as null" );
		expect( toScf( seo, { metaTitle: 'x', noindex: null } ) ).toEqual( { metaTitle: 'x', when: '', extra: '' }, 'a null boolean is left out (SCF would refuse "" and skip null) while members the form does not hold clear where they can' );
		expect( toScf( seo, { metaTitle: 'x', noindex: false } ) ).toEqual( { metaTitle: 'x', noindex: 0, when: '', extra: '' }, 'false is a boolean value, not a clear' );
		expect( toScf( { type: 'group', fields: { tags: { type: 'select', multiple: true, enum: [ 'a' ] }, pics: { type: 'mediaList' } } }, { tags: null, pics: null } ) ).toEqual( { tags: [], pics: [] } );
		expect( toScf( { type: 'repeater', fields: { on: { type: 'boolean' } } }, [ { on: true }, { on: false } ] ) ).toEqual( [ { on: 1 }, { on: 0 } ] );
		expect( toScf( sections, [ { layout: 'hero', heading: 'H', image: 3 }, { layout: 'quote', text: 'q' } ] ) ).toEqual( [ { heading: 'H', image: 3, acf_fc_layout: 'hero' }, { text: 'q', acf_fc_layout: 'quote' } ] );
		// A member named like the discriminator cannot overwrite it, and an inherited name is a member like any other.
		const odd: DescribedColumn = { type: 'blocks', layouts: { hero: { acf_fc_layout: { type: 'text' }, heading: { type: 'text' } } } };
		expect( toScf( odd, [ { layout: 'hero', acf_fc_layout: 'quote', heading: 'H' } ], undefined, 'field_x' ) ).toEqual( [ { field_x_hero_acf_fc_layout: 'quote', field_x_hero_heading: 'H', acf_fc_layout: 'hero' } ] );
		const ctor: DescribedColumn = { type: 'group', fields: { constructor: { type: 'integer', default: { value: 3 } }, note: { type: 'text' } } };
		expect( toScf( ctor, { note: 'n' }, undefined, 'field_g' ) ).toEqual( { field_g_constructor: 3, field_g_note: 'n' } );
		expect( unclearable( ctor, { note: 'n' }, '/g', { constructor: 7, note: 'o' } ) ).toBeNull();
		expect( unclearable( { type: 'group', fields: { constructor: { type: 'integer' } } }, {}, '/g', {} ) ).toBeNull();
	} );
} );

describe( 'fromScf', () => {
	it( 'decodes dates, timestamps, booleans, numbers and JSON text back into Zero values', () => {
		expect( fromScf( { type: 'date' }, '20260201' ) ).toBe( '2026-02-01' );
		expect( fromScf( { type: 'timestamp' }, '2026-02-01 10:30:00' ) ).toBe( '2026-02-01T10:30:00.000Z' );
		expect( fromScf( { type: 'timestamp' }, '2026-02-01 11:30:00', { timezone: 'Europe/Berlin', gmtOffset: 1 } ) ).toBe( '2026-02-01T10:30:00.000Z' );
		expect( fromScf( { type: 'timestamp' }, '2026-07-01 12:30:00', { timezone: 'Europe/Berlin', gmtOffset: 1 } ) ).toBe( '2026-07-01T10:30:00.000Z' );
		expect( fromSiteTime( toSiteTime( '2026-03-29T01:30:00.000Z', { timezone: 'Europe/Berlin', gmtOffset: 1 } ), { timezone: 'Europe/Berlin', gmtOffset: 1 } ) ).toBe( '2026-03-29T01:30:00.000Z' );
		expect( fromScf( { type: 'boolean' }, '1' ) ).toBe( true );
		expect( fromScf( { type: 'boolean' }, 0 ) ).toBe( false );
		expect( fromScf( { type: 'integer' }, '42' ) ).toBe( 42 );
		expect( fromScf( { type: 'media' }, '9' ) ).toBe( 9 );
		expect( fromScf( { type: 'json' }, '{"a":2}' ) ).toEqual( { a: 2 } );
		expect( fromScf( { type: 'json' }, 'not json' ) ).toBe( 'not json' );
		expect( fromScf( { type: 'mediaList' }, [ '7', { ID: 8 } ] ) ).toEqual( [ 7, 8 ] );
	} );

	it( 'treats SCF emptiness as null, or the empty list for a required list', () => {
		expect( fromScf( { type: 'text' }, '' ) ).toBeNull();
		expect( fromScf( { type: 'mediaList', notNull: true }, '' ) ).toEqual( [] );
		expect( fromScf( { type: 'select', multiple: true }, null ) ).toBeNull();
	} );

	it( 'decodes nested kinds whichever key form SCF used, and reads the block layout', () => {
		expect( fromScf( seo, { metaTitle: 'T', zero_seo_noindex: '1', field_zero_posts_seo_when: '20260201', extra: '{"b":1}' } ) ).toEqual( { metaTitle: 'T', noindex: true, when: '2026-02-01', extra: { b: 1 } } );
		expect( fromScf( seo, { metaTitle: 'T', zero_seo_when: '20260201' } ) ).toEqual( { metaTitle: 'T', when: '2026-02-01' } );
		expect( fromScf( sections, [ { acf_fc_layout: 'hero', heading: 'H', image: '3' }, { layout: 'quote', text: 'q' } ] ) ).toEqual( [ { layout: 'hero', heading: 'H', image: 3 }, { layout: 'quote', text: 'q' } ] );
	} );

	it( 'names the nested clears core cannot apply, judged against what was stored, so the screen refuses instead of keeping the old value', () => {
		expect( unclearable( seo, { metaTitle: 'x', noindex: null }, '/seo', { metaTitle: 'x', noindex: true } ) ).toBe( '/seo/noindex' );
		expect( unclearable( seo, { metaTitle: 'x', noindex: null }, '/seo', { metaTitle: 'y', noindex: null } ) ).toBeNull();
		expect( unclearable( seo, { metaTitle: 'x', noindex: null }, '/seo' ) ).toBeNull();
		expect( unclearable( seo, { metaTitle: null }, '/seo', { metaTitle: 'was' } ) ).toBeNull();
		const rep: DescribedColumn = { type: 'repeater', fields: { count: { type: 'integer' }, caption: { type: 'text' } } };
		expect( unclearable( rep, [ { count: 1, caption: null }, { count: null, caption: 'c' } ], '/items', [ { count: 1, caption: 'a' }, { count: 7, caption: 'c' } ] ) ).toBe( '/items/1/count' );
		expect( unclearable( sections, [ { layout: 'hero', heading: null, image: null } ], '/sections', [ { layout: 'hero', heading: 'H', image: 3 } ] ) ).toBe( '/sections/0/image' );
		expect( unclearable( sections, [ { layout: 'hero', heading: 'H', image: null } ], '/sections', [ { layout: 'hero', heading: 'H', image: false } ] ) ).toBeNull();
		const contact: DescribedColumn = { type: 'group', fields: { email: { type: 'email' }, site: { type: 'url' } } };
		expect( unclearable( contact, { email: null, site: 'https://a.b' }, '/profile', { email: 'a@b.c', site: 'https://a.b' } ) ).toBe( '/profile/email' );
		expect( unclearable( { type: 'integer' }, null ) ).toBeNull();
		// A boolean's false is a value both ways: true → false saves; false → null is a clear SCF cannot apply.
		expect( unclearable( seo, { metaTitle: 'x', noindex: false }, '/seo', { metaTitle: 'x', noindex: true } ) ).toBeNull();
		expect( unclearable( seo, { metaTitle: 'x', noindex: null }, '/seo', { metaTitle: 'x', noindex: false } ) ).toBe( '/seo/noindex' );
		// A member missing from the edited object is null to Zero, so dropping a stored number is a clear too.
		const rep2: DescribedColumn = { type: 'repeater', fields: { count: { type: 'integer' }, caption: { type: 'text' } } };
		expect( unclearable( rep2, [ { caption: 'b' } ], '/items', [ { count: 7, caption: 'a' } ] ) ).toBe( '/items/0/count' );
		expect( unclearable( rep2, [ { caption: 'b' } ], '/items', [ { caption: 'a' } ] ) ).toBeNull();
	} );

	it( "gives an omitted member its declared default, as Zero's normaliser does, and leaves a server-computed one alone", () => {
		const card: DescribedColumn = { type: 'group', fields: { body: { type: 'text' }, caption: { type: 'text', default: { value: 'Untitled' } }, at: { type: 'timestamp', default: { now: true } }, count: { type: 'integer', default: { value: 3 } } } };
		expect( toScf( card, { body: 'new' } ) ).toEqual( { body: 'new', caption: 'Untitled', count: 3 } );
		expect( unclearable( card, { body: 'new' }, '/card', { body: 'old', caption: 'x', count: 7, at: '2026-01-01T00:00:00.000Z' } ) ).toBeNull();
		const bare: DescribedColumn = { type: 'group', fields: { body: { type: 'text' }, count: { type: 'integer' } } };
		expect( unclearable( bare, { body: 'new' }, '/card', { body: 'old', count: 7 } ) ).toBe( '/card/count' );
		// A constant default is judged like a supplied value: a default that is empty over a stored value is a clear.
		const nullDefault: DescribedColumn = { type: 'group', fields: { count: { type: 'integer', default: { value: null } }, note: { type: 'text' } } };
		expect( unclearable( nullDefault, { note: 'x' }, '/s', { count: 7, note: 'old' } ) ).toBe( '/s/count' );
		const nested: DescribedColumn = { type: 'group', fields: { settings: { type: 'group', default: { value: { count: null, note: 'reset' } }, fields: { count: { type: 'integer' }, note: { type: 'text' } } } } };
		expect( unclearable( nested, {}, '/w', { settings: { count: 7, note: 'old' } } ) ).toBe( '/w/settings/count' );
		expect( unclearable( nested, {}, '/w', { settings: { count: null, note: 'old' } } ) ).toBeNull();
	} );

	it( 'names a member the schema does not know, in a group, a repeater row or a block, before anything is encoded', () => {
		const card: DescribedColumn = { type: 'group', fields: { caption: { type: 'text' }, inner: { type: 'group', fields: { a: { type: 'text' } } } } };
		expect( unknownMember( card, { captino: 'new' }, '/card' ) ).toBe( '/card/captino' );
		expect( unknownMember( card, { caption: 'ok', inner: { b: 1 } }, '/card' ) ).toBe( '/card/inner/b' );
		expect( unknownMember( card, { caption: 'ok' }, '/card' ) ).toBeNull();
		const rep: DescribedColumn = { type: 'repeater', fields: { count: { type: 'integer' } } };
		expect( unknownMember( rep, [ { count: 1 }, { cnt: 2 } ], '/items' ) ).toBe( '/items/1/cnt' );
		expect( unknownMember( sections, [ { layout: 'hero', heading: 'H' }, { layout: 'quote', txt: 'q' } ], '/sections' ) ).toBe( '/sections/1/txt' );
		expect( unknownMember( sections, [ { layout: 'nope' } ], '/sections' ) ).toBe( '/sections/0/layout' );
		expect( unknownMember( { type: 'json' }, { anything: 1 } ) ).toBeNull();
		// Inherited names are not schema members.
		expect( unknownMember( card, { constructor: 'new' }, '/card' ) ).toBe( '/card/constructor' );
		expect( unknownMember( card, { toString: 'x', caption: 'ok' }, '/card' ) ).toBe( '/card/toString' );
		expect( unknownMember( sections, [ { layout: 'constructor' } ], '/sections' ) ).toBe( '/sections/0/layout' );
		// A block member named like SCF's discriminator cannot be read back without ambiguity, so it is refused up front.
		const odd: DescribedColumn = { type: 'blocks', layouts: { hero: { acf_fc_layout: { type: 'text' }, heading: { type: 'text' } } } };
		expect( unknownMember( odd, [ { layout: 'hero', acf_fc_layout: 'quote', heading: 'H' } ], '/s' ) ).toBe( '/s/0/acf_fc_layout' );
		expect( unknownMember( odd, [ { layout: 'hero', acf_fc_layout: null, heading: 'H' } ], '/s' ) ).toBe( '/s/0/acf_fc_layout' );
		expect( unknownMember( odd, [ { layout: 'hero', heading: 'H' } ], '/s' ) ).toBe( '/s/0/acf_fc_layout', 'the layout itself cannot round-trip, so an omitted member is refused too' );
		expect( unknownMember( sections, [ { layout: 'hero', heading: 'H' } ], '/s' ) ).toBeNull();
		// A constant default an omitted member would take is validated too, since it is what gets encoded.
		const settings: DescribedColumn = { type: 'group', fields: { caption: { type: 'text' }, sections: { ...odd, default: { value: [ { layout: 'hero', heading: 'Default' } ] } } } };
		expect( unknownMember( settings, { caption: 'Updated' }, '/settings' ) ).toBe( '/settings/sections/0/acf_fc_layout' );
		const fine: DescribedColumn = { type: 'group', fields: { caption: { type: 'text' }, sections: { ...sections, default: { value: [ { layout: 'hero', heading: 'Default' } ] } } } };
		expect( unknownMember( fine, { caption: 'Updated' }, '/settings' ) ).toBeNull();
		const typoDefault: DescribedColumn = { type: 'group', fields: { inner: { type: 'group', fields: { a: { type: 'text' } }, default: { value: { b: 1 } } } } };
		expect( unknownMember( typoDefault, {}, '/g' ) ).toBe( '/g/inner/b' );
	} );

	it( "reads SCF's false for an empty image or file as empty, so an untouched sibling is never resubmitted as false", () => {
		expect( fromScf( { type: 'media' }, false ) ).toBeNull();
		expect( fromScf( { type: 'file' }, false ) ).toBeNull();
		expect( fromScf( { type: 'boolean' }, false ) ).toBe( false );
		expect( fromScf( sections, [ { acf_fc_layout: 'hero', heading: 'H', image: false } ] ) ).toEqual( [ { layout: 'hero', heading: 'H', image: null } ] );
	} );

	it( 'matches prefixed aliases by the whole prefix, so a sibling whose name ends like another never answers for it', () => {
		const pair: DescribedColumn = { type: 'group', fields: { id: { type: 'integer' }, parent_id: { type: 'integer' } } };
		expect( fromScf( pair, { zero_g_parent_id: '9', zero_g_id: '3' } ) ).toEqual( { id: 3, parent_id: 9 } );
		expect( fromScf( pair, { field_zero_posts_g_parent_id: '9', field_zero_posts_g_id: '3' } ) ).toEqual( { id: 3, parent_id: 9 } );
	} );

	it( 'round-trips through both directions', () => {
		const value = { metaTitle: 'T', noindex: false, when: '2026-02-01', extra: [ 1, 2 ] };
		expect( fromScf( seo, toScf( seo, value ) as Record< string, unknown > ) ).toEqual( value );
	} );
} );
