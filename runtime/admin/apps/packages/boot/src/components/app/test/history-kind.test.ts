import { historyKind } from '../history-kind';

describe( 'historyKind', () => {
	it( 'uses the browser history under the mount, including a subdirectory install', () => {
		expect( historyKind( '/zero-admin/media', '/zero-admin' ) ).toBe( 'browser' );
		expect( historyKind( '/zero-admin', '/zero-admin' ) ).toBe( 'browser' );
		expect( historyKind( '/blog/zero-admin/media', '/blog/zero-admin' ) ).toBe( 'browser' );
	} );

	it( 'uses the query history off the mount, and does not confuse a prefix for the mount', () => {
		expect( historyKind( '/wp-admin/admin.php', '/zero-admin' ) ).toBe( 'query' );
		expect( historyKind( '/blog/zero-admin/media', '/zero-admin' ) ).toBe( 'query' );
		expect( historyKind( '/zero-administration', '/zero-admin' ) ).toBe( 'query' );
	} );
} );
