import { clearProblem, postOfRow, rowOfPost, scheduleProblem, unknownProblem } from '../post-row';
import { posts } from '../test-fixtures';

describe( 'rowOfPost', () => {
	it( 'reads core columns from their core fields, SCF fields from acf, and maps the status', () => {
		const row = rowOfPost( {
			id: 7, status: 'publish', slug: 'hello', date_gmt: '2026-01-02T03:04:05',
			title: { raw: 'Hello', rendered: 'Hello' }, content: { raw: '<p>x</p>', rendered: '<p>x</p>' },
			acf: { zero_excerpt: 'Short', zero_tags: [ 'news' ], zero_seo: { metaTitle: 'T', noindex: false }, zero_unknown: 1 },
		}, posts );
		expect( row ).toEqual( { id: 7, title: 'Hello', slug: 'hello', body: '<p>x</p>', status: 'published', publishedAt: '2026-01-02T03:04:05Z', excerpt: 'Short', tags: [ 'news' ], seo: { metaTitle: 'T', noindex: false } } );
	} );

	it( 'leaves a column absent when the response did not carry it, and a draft without a publish date', () => {
		const row = rowOfPost( { id: 8, status: 'draft', title: 'D', acf: {} }, posts );
		expect( 'excerpt' in row ).toBe( false );
		expect( row.status ).toBe( 'draft' );
		expect( row.publishedAt ).toBeUndefined();
		expect( rowOfPost( { id: 9, status: 'draft', date_gmt: '2026-01-01T00:00:00', acf: [] }, posts ).publishedAt ).toBeNull();
	} );
} );

describe( 'postOfRow', () => {
	it( 'sends core columns by core name and the rest under acf, never the key; the publish date rides as date_gmt', () => {
		expect( postOfRow( { id: 7, title: 'New', slug: 'new', body: '<p>b</p>', status: 'published', publishedAt: '2030-01-02T03:04:05.000Z', excerpt: 'E', tags: [ 'guide' ] }, posts ) ).toEqual( {
			title: 'New', slug: 'new', content: '<p>b</p>', status: 'publish', date_gmt: '2030-01-02T03:04:05', acf: { zero_excerpt: 'E', zero_tags: [ 'guide' ] },
		} );
		expect( postOfRow( { excerpt: 'only' }, posts ) ).toEqual( { acf: { zero_excerpt: 'only' } } );
	} );

	it( 'carries a json column as JSON text in acf, the form SCF keeps it in, and decodes it coming back', () => {
		const withJson = { ...posts, columns: { ...posts.columns, extra: { type: 'json' as const }, deck: { type: 'file' as const }, gallery: { type: 'mediaList' as const } } };
		expect( postOfRow( { extra: { a: 2 } }, withJson ) ).toEqual( { acf: { zero_extra: '{"a":2}' } } );
		expect( postOfRow( { extra: null }, withJson ) ).toEqual( { acf: { zero_extra: null } } );
		const row = rowOfPost( { id: 1, acf: { zero_extra: '{"a":2}', zero_deck: '42', zero_gallery: [ '7', { ID: 8 } ] } }, withJson );
		expect( row.extra ).toEqual( { a: 2 } );
		expect( row.deck ).toBe( 42 );
		expect( row.gallery ).toEqual( [ 7, 8 ] );
	} );

	it( 'refuses to schedule without a future date, since core would publish at once', () => {
		const now = new Date( '2026-02-01T00:00:00Z' );
		expect( scheduleProblem( { status: 'scheduled' }, now ) ).toBe( 'Scheduling needs a publish date.' );
		expect( scheduleProblem( { status: 'scheduled', publishedAt: '2026-01-01T00:00:00.000Z' }, now ) ).toBe( 'The publish date must be at least two minutes ahead to schedule.' );
		expect( scheduleProblem( { status: 'scheduled', publishedAt: '2026-02-01T00:00:30.000Z' }, now ) ).toBe( 'The publish date must be at least two minutes ahead to schedule.', 'core publishes a future post under a minute away at once' );
		expect( scheduleProblem( { status: 'scheduled', publishedAt: '2026-02-01T00:02:00.000Z' }, now ) ).toBeNull();
		expect( scheduleProblem( { status: 'scheduled', publishedAt: '2026-03-01T00:00:00.000Z' }, now ) ).toBeNull();
		expect( scheduleProblem( { status: 'published' }, now ) ).toBeNull();
	} );

	it( 'points at a member the schema does not know', () => {
		expect( unknownProblem( { seo: { metaTitel: 'x' } }, posts ) ).toBe( '/seo/metaTitel' );
		expect( unknownProblem( { seo: { metaTitle: 'x' }, excerpt: 'e' }, posts ) ).toBeNull();
	} );

	it( 'points at a nested clear core cannot apply, and lets an already-empty sibling through', () => {
		expect( clearProblem( { seo: { metaTitle: 'x', noindex: null } }, posts, { seo: { metaTitle: 'x', noindex: true } } ) ).toBe( '/seo/noindex' );
		expect( clearProblem( { seo: { metaTitle: 'x', noindex: null } }, posts, { seo: { metaTitle: 'y', noindex: null } } ) ).toBeNull();
		expect( clearProblem( { seo: { metaTitle: null }, excerpt: null }, posts, { seo: { metaTitle: 'was' }, excerpt: 'was' } ) ).toBeNull();
	} );

	it( 'converts nested structures both ways, including a block layout discriminator', () => {
		expect( postOfRow( { seo: { metaTitle: 'T', noindex: true }, sections: [ { layout: 'hero', heading: 'H' } ] }, posts ) ).toEqual( {
			acf: {
				zero_seo: { field_zero_posts_seo_metaTitle: 'T', field_zero_posts_seo_noindex: 1 },
				zero_sections: [ { field_zero_posts_sections_hero_heading: 'H', acf_fc_layout: 'hero' } ],
			},
		} );
		const row = rowOfPost( { id: 2, acf: { zero_seo: { metaTitle: 'T', zero_seo_noindex: '0' }, zero_sections: [ { acf_fc_layout: 'hero', heading: 'H' } ] } }, posts );
		expect( row.seo ).toEqual( { metaTitle: 'T', noindex: false } );
		expect( row.sections ).toEqual( [ { layout: 'hero', heading: 'H' } ] );
	} );
} );
