import { historyKind } from '../history-kind';

describe( 'historyKind', () => {
	it( 'uses the browser history under the mount, including a subdirectory install', () => {
		expect( historyKind( '/first-admin/media', '/first-admin' ) ).toBe( 'browser' );
		expect( historyKind( '/first-admin', '/first-admin' ) ).toBe( 'browser' );
		expect( historyKind( '/blog/first-admin/media', '/blog/first-admin' ) ).toBe( 'browser' );
	} );

	it( 'uses the query history off the mount, and does not confuse a prefix for the mount', () => {
		expect( historyKind( '/wp-admin/admin.php', '/first-admin' ) ).toBe( 'query' );
		expect( historyKind( '/blog/first-admin/media', '/first-admin' ) ).toBe( 'query' );
		expect( historyKind( '/first-administration', '/first-admin' ) ).toBe( 'query' );
	} );
} );
