import { menuOf, readableCollections } from '../menu';
import { schema } from '../test-fixtures';

describe( 'menuOf', () => {
	it( 'lists the overview, the permitted collections, media, the permitted globals and the classic admin, in that order', () => {
		const entries = menuOf( schema, { collections: { posts: true, field_staff: true, vault: false }, globals: { settings: true, secrets: false } } );
		expect( entries.map( ( e ) => [ e.kind, e.to, e.label ] ) ).toEqual( [
			[ 'overview', '/', 'Collections' ],
			[ 'collection', '/collections/posts', 'Posts' ],
			[ 'collection', '/collections/field_staff', 'Staff' ],
			[ 'media', '/media', 'Media' ],
			[ 'global', '/globals/settings', 'Site settings' ],
			[ 'classic', '/legacy/index.php', 'Classic admin' ],
		] );
	} );

	it( 'omits a collection the API does not list and one the page did not permit', () => {
		const noList = { ...schema, collections: { ...schema.collections, posts: { ...schema.collections.posts, api: { list: false } } } };
		expect( readableCollections( noList, { collections: { posts: true, field_staff: true, vault: true }, globals: {} } ) ).toEqual( [ 'field_staff', 'vault' ] );
		expect( readableCollections( schema, { collections: {}, globals: {} } ) ).toEqual( [] );
	} );
} );
