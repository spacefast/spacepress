import { historyKind } from '../history-kind';

describe( 'historyKind', () => {
	it( 'uses the browser history under the mount, including a subdirectory install', () => {
		expect( historyKind( '/wp-admin/new/media', '/wp-admin/new' ) ).toBe( 'browser' );
		expect( historyKind( '/wp-admin/new', '/wp-admin/new' ) ).toBe( 'browser' );
		expect( historyKind( '/blog/wp-admin/new/media', '/blog/wp-admin/new' ) ).toBe( 'browser' );
	} );

	it( 'uses the query history off the mount, and does not confuse a prefix for the mount', () => {
		expect( historyKind( '/wp-admin/admin.php', '/wp-admin/new' ) ).toBe( 'query' );
		expect( historyKind( '/blog/wp-admin/new/media', '/wp-admin/new' ) ).toBe( 'query' );
		expect( historyKind( '/wp-admin/newsletter', '/wp-admin/new' ) ).toBe( 'query' );
	} );
} );
