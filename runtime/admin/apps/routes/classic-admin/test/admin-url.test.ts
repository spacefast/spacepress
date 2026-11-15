import { isUnderAdmin, resolveAdminUrl, slugOf } from '../admin-url';

const root = 'https://example.test/wp-admin/';
const sub = 'https://example.test/blog/wp-admin/';

describe( 'resolveAdminUrl', () => {
	it( 'resolves admin-relative slugs under the admin base the page handed in', () => {
		expect( resolveAdminUrl( 'options-media.php', root ) ).toBe( `${ root }options-media.php` );
		expect( resolveAdminUrl( 'edit.php?post_type=page', sub ) ).toBe( `${ sub }edit.php?post_type=page` );
	} );

	it( 'falls back to the admin index for anything that would leave wp-admin', () => {
		for ( const slug of [ 'javascript:alert(1)', 'data:text/html,hi', '//evil.example/x', 'https://evil.example/wp-admin/', '../wp-login.php', '/wp-login.php', '/blog/index.php' ] ) {
			expect( resolveAdminUrl( slug, sub ) ).toBe( sub );
		}
	} );
} );

describe( 'isUnderAdmin and slugOf', () => {
	it( 'classify same-origin links outside wp-admin as leaving the frame', () => {
		expect( isUnderAdmin( 'https://example.test/blog/hello-world/', sub ) ).toBe( false );
		expect( isUnderAdmin( 'https://example.test/blog/wp-login.php?action=logout', sub ) ).toBe( false );
		expect( isUnderAdmin( 'https://example.test/wp-admin/options.php', sub ) ).toBe( false );
		expect( isUnderAdmin( `${ sub }post.php?post=1&action=edit`, sub ) ).toBe( true );
		expect( slugOf( `${ sub }post.php?post=1&action=edit#x`, sub ) ).toBe( 'post.php?post=1&action=edit#x' );
		expect( slugOf( 'https://example.test/blog/hello-world/', sub ) ).toBeNull();
	} );
} );
