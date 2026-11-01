import { cleanRow, defaultTableFields, fieldsOf, formOf, requiredColumns } from '../fields';
import { posts, staff } from '../test-fixtures';

const byId = ( fields: ReturnType< typeof fieldsOf > ) => Object.fromEntries( fields.map( ( f ) => [ f.id, f ] ) );

describe( 'fieldsOf', () => {
	it( 'maps every column kind onto a DataViews type, structured kinds onto a JSON text with no sorting', () => {
		const f = byId( fieldsOf( posts.columns, { primaryKey: 'id' } ) );
		expect( f.title.type ).toBe( 'text' );
		expect( f.excerpt.type ).toBe( 'text' );
		expect( f.authorId.type ).toBe( 'integer' );
		expect( f.createdAt.type ).toBe( 'datetime' );
		expect( f.cover.type ).toBe( 'media' );
		expect( f.gallery.type ).toBeUndefined();
		expect( f.gallery.isValid?.custom ).toBeDefined();
		expect( f.tags.type ).toBe( 'array' );
		expect( f.seo.type ).toBeUndefined();
		expect( f.seo.enableSorting ).toBe( false );
		expect( f.seo.filterBy ).toBe( false );
		expect( f.seo.getValue?.( { item: { seo: { metaTitle: 'x' } } } ) ).toBe( '{\n  "metaTitle": "x"\n}' );
		expect( f.body.type ).toBeUndefined();
		expect( f.body.Edit ).toBe( 'textarea' );
	} );

	it( 'turns enums into elements, booleans into yes/no, and multiline text into a textarea', () => {
		const f = byId( fieldsOf( staff.columns ) );
		expect( f.kind.elements ).toEqual( [ { value: 'basic', label: 'basic' }, { value: 'pro', label: 'pro' } ] );
		expect( f.kind.isValid?.elements ).toBe( false );
		expect( f.active.isValid?.elements ).toBe( false );
		expect( f.active.elements ).toEqual( [ { value: true, label: 'Yes' }, { value: false, label: 'No' } ] );
		const g = byId( fieldsOf( { bio: { type: 'text', multiline: true } } ) );
		expect( g.bio.Edit ).toBe( 'textarea' );
	} );

	it( 'marks generated columns read-only and derives validation from notNull and rules', () => {
		const f = byId( fieldsOf( posts.columns, { primaryKey: 'id', wp: posts.wp } ) );
		expect( f.id.readOnly ).toBe( true );
		expect( f.status.readOnly ).toBe( false );
		expect( f.publishedAt.readOnly ).toBe( false );
		expect( f.createdAt.readOnly ).toBe( true );
		expect( f.title.readOnly ).toBe( false );
		expect( f.title.isValid ).toEqual( { required: true, minLength: 1, maxLength: 120 } );
		expect( f.seo.isValid?.custom ).toBeDefined();
		expect( f.excerpt.isValid ).toEqual( { maxLength: 300 } );
		expect( f.tags.isValid ).toEqual( { elements: false } );
		const g = byId( fieldsOf( { seats: { type: 'integer', rules: { min: 1, max: 50 } } } ) );
		expect( g.seats.isValid ).toEqual( { min: 1, max: 50 } );
	} );

	it( 'evaluates showIf against the sibling values of the row', () => {
		const f = byId( fieldsOf( staff.columns ) );
		expect( f.plan.isVisible?.( { kind: 'pro' } ) ).toBe( true );
		expect( f.plan.isVisible?.( { kind: 'basic' } ) ).toBe( false );
		expect( f.name.isVisible ).toBeUndefined();
	} );

	it( 'parses a structured column back from its JSON text, holds the save while it does not parse, and sends nothing of the draft', () => {
		const f = byId( fieldsOf( posts.columns ) );
		const typed = f.seo.setValue!( { item: { seo: { metaTitle: 'x' } }, value: '{"metaTitle":"y","noindex":true}' } ) as Record< string, unknown >;
		expect( typed.seo ).toEqual( { metaTitle: 'y', noindex: true } );
		expect( cleanRow( { seo: { a: 1 }, ...typed } ) ).toEqual( { seo: { metaTitle: 'y', noindex: true } } );
		const half = f.seo.setValue!( { item: { seo: { metaTitle: 'x' } }, value: '{"metaTitle":' } ) as Record< string, unknown >;
		expect( 'seo' in half ).toBe( false );
		const item = { seo: { metaTitle: 'x' }, ...half };
		expect( f.seo.getValue?.( { item } ) ).toBe( '{"metaTitle":' );
		expect( ( f.seo.isValid as { custom: ( i: unknown, fl: unknown ) => string | null } ).custom( item, f.seo ) ).toBe( 'Enter valid JSON.' );
		expect( ( f.seo.isValid as { custom: ( i: unknown, fl: unknown ) => string | null } ).custom( { seo: { metaTitle: 'x' } }, f.seo ) ).toBeNull();
		const cleared = f.seo.setValue!( { item: {}, value: '' } ) as Record< string, unknown >;
		expect( cleared.seo ).toBeNull();
	} );

	it( 'shows a stored JSON string quoted, so it parses back as the same string', () => {
		const f = byId( fieldsOf( { extra: { type: 'json' } } ) );
		expect( f.extra.getValue?.( { item: { extra: 'hello' } } ) ).toBe( '"hello"' );
		expect( ( f.extra.setValue!( { item: {}, value: '"hello"' } ) as Record< string, unknown > ).extra ).toBe( 'hello' );
		expect( ( f.extra.isValid as { custom: ( i: unknown, fl: unknown ) => string | null } ).custom( { extra: 'hello' }, f.extra ) ).toBeNull();
	} );

	it( 'validates media ids as numbers and edits a file column as an integer', () => {
		const f = byId( fieldsOf( { gallery: { type: 'mediaList' }, doc: { type: 'file' }, cover: { type: 'media', accept: 'image' } } ) );
		const valid = ( f.gallery.isValid as { custom: ( i: unknown, fl: unknown ) => string | null } ).custom;
		expect( valid( { gallery: [ 12, 34 ] }, f.gallery ) ).toBeNull();
		expect( valid( { gallery: [ 'x' ] }, f.gallery ) ).toBe( 'Every item must be a media id.' );
		expect( f.doc.type ).toBe( 'integer' );
		expect( f.cover.type ).toBe( 'media' );
		expect( ( f.cover as { accept?: string } ).accept ).toBe( 'image' );
	} );

	it( 'leaves a hand-written table key editable and marks a required boolean by presence, not by being checked', () => {
		const codes = byId( fieldsOf( { id: { type: 'text', primaryKey: true, notNull: true }, rank: { type: 'integer' } }, { primaryKey: 'id', wp: null } ) );
		expect( codes.id.readOnly ).toBe( false );
		expect( codes.id.isValid ).toEqual( { required: true } );
		const f = byId( fieldsOf( { active: { type: 'boolean', notNull: true } } ) );
		expect( f.active.isValid?.required ).toBeUndefined();
		const custom = ( f.active.isValid as { custom: ( i: unknown, fl: unknown ) => string | null } ).custom;
		expect( custom( { active: false }, f.active ) ).toBeNull();
		expect( custom( {}, f.active ) ).toBe( 'Choose yes or no.' );
	} );

	it( 'labels columns as words', () => {
		const f = byId( fieldsOf( posts.columns ) );
		expect( f.publishedAt.label ).toBe( 'Published at' );
		expect( f.authorId.label ).toBe( 'Author id' );
	} );
} );

describe( 'defaultTableFields', () => {
	it( 'puts the title first and leaves out the key, the content, media, structured kinds and columns the viewer may not read', () => {
		expect( defaultTableFields( posts, { id: 2, role: 'editor' } ) ).toEqual( [ 'title', 'slug', 'excerpt', 'tags', 'authorId', 'createdAt' ] );
		expect( defaultTableFields( staff, { id: 2, role: 'editor' } ) ).toEqual( [ 'name', 'kind', 'active', 'plan' ] );
		expect( defaultTableFields( staff, { id: 1, role: 'admin' } ) ).toEqual( [ 'name', 'salary', 'kind', 'active', 'plan' ] );
	} );
} );

describe( 'formOf and requiredColumns', () => {
	it( 'lists every editable column in schema order, without the key, generated columns or the content column', () => {
		expect( formOf( posts.columns, { primaryKey: 'id', wp: posts.wp, content: 'body' } ).fields ).toEqual( [ 'title', 'slug', 'excerpt', 'cover', 'gallery', 'tags', 'authorId', 'seo', 'sections', 'status', 'publishedAt' ] );
		expect( formOf( posts.columns, { primaryKey: 'id', wp: posts.wp } ).fields ).toContain( 'body' );
		expect( requiredColumns( posts ) ).toEqual( [ 'title' ] );
		expect( requiredColumns( staff ) ).toEqual( [ 'name' ] );
		expect( requiredColumns( { primaryKey: 'code', wp: null, columns: { code: { type: 'text', primaryKey: true, notNull: true } } } ) ).toEqual( [ 'code' ] );
	} );
} );
