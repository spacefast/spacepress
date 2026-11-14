// One screen declared once (tests/wp/mu-plugins/admin-screen.php, runtime/admin/lib/screens.php)
// renders natively in both admins: First Admin's /screens/<id> route and a classic wp-admin page.
// Both show the same fields and actions, run the same Ability, and the server decides access in
// both: a subscriber sees the screen but may not approve, in either admin.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const harness = JSON.parse(
	readFileSync(
		process.env.FIRST_WP_HARNESS ??
			fileURLToPath( new URL( '../../../../tests/wp/.harness.json', import.meta.url ) ),
		'utf8'
	)
);
const site: string = harness.url;
const subdir = new URL( site ).pathname !== '/';
const auth = ( role: string ) => ( {
	Authorization: `Basic ${ Buffer.from( `${ role }:${ harness.users[ role ].appPassword }` ).toString( 'base64' ) }`,
} );

/** A post for the comments to belong to. */
async function post( request: import( '@playwright/test' ).APIRequestContext ): Promise< number > {
	const made = await request.post( `${ site }/__first/api/v1/posts`, { headers: auth( 'admin' ), data: { title: `Screen post ${ Date.now() }` } } );
	expect( made.status(), await made.text() ).toBe( 201 );
	return ( await made.json() ).data.id;
}

async function signIn( page: Page, role: 'admin' | 'subscriber' ) {
	await page.goto( `${ site }/wp-login.php` );
	await page.locator( '#user_login' ).fill( role );
	await page.locator( '#user_pass' ).fill( `first-test-${ role }` );
	await page.locator( '#wp-submit' ).click();
	await expect( page ).toHaveURL( `${ site }/wp-admin/new/` );
}

const hosts = {
	'First Admin': `/wp-admin/new/screens/test-comments`,
	'classic wp-admin': `/wp-admin/admin.php?page=first-screen-test-comments`,
};

/** What the screen shows: its title, column headings, the comment row and the row's actions. */
async function shown( page: Page, body: string ) {
	const screen = page.locator( '[data-screen="test-comments"]' );
	await expect( page.getByRole( 'heading', { name: 'Comment review', exact: true } ) ).toBeVisible();
	await expect( screen.getByText( 'Approving a comment publishes it.' ) ).toBeVisible();
	const row = screen.getByRole( 'row' ).filter( { hasText: body } );
	await expect( row ).toBeVisible();
	const headings = await screen.getByRole( 'columnheader' ).allInnerTexts();
	await row.getByRole( 'button', { name: 'Actions' } ).click();
	const actions = await page.getByRole( 'menuitem' ).allInnerTexts();
	await page.keyboard.press( 'Escape' );
	return { headings: headings.map( ( h ) => h.trim() ).filter( Boolean ), actions, row };
}

test.skip( subdir, 'the standard install covers the screen; the subdirectory lane covers mounting' );

test( 'a screen declared once has the same fields and actions in both admins, and runs the same ability', async ( { page, request } ) => {
	const errors: string[] = [];
	page.on( 'pageerror', ( e ) => errors.push( e.message ) );
	const postId = await post( request );
	const made = [];
	for ( const which of Object.keys( hosts ) ) {
		const body = `Screen check ${ which } ${ Date.now() }`;
		const created = await request.post( `${ site }/__first/api/v1/comments`, {
			headers: auth( 'admin' ),
			data: { postId, name: 'Reader', body },
		} );
		made.push( { which, body, created } );
	}
	for ( const m of made ) {
		expect( m.created.status(), await m.created.text() ).toBe( 201 );
	}
	await signIn( page, 'admin' );
	const seen: Record< string, { headings: string[]; actions: string[] } > = {};
	for ( const [ which, path ] of Object.entries( hosts ) ) {
		const { body, created } = made.find( ( m ) => m.which === which )!;
		const id = ( await created.json() ).data.id;
		await page.goto( `${ site }${ path }` );
		if ( which === 'classic wp-admin' ) {
			// wp-admin's own chrome around it: the admin menu lists the page under Comments.
			await expect( page.locator( '#adminmenu a[href$="page=first-screen-test-comments"]' ) ).toBeVisible();
		} else {
			await expect( page.locator( '.first-admin-sidebar__content' ).getByRole( 'link', { name: 'Comment review', exact: true } ) ).toBeVisible();
		}
		const { headings, actions, row } = await shown( page, body );
		seen[ which ] = { headings, actions };
		await page.screenshot( { path: test.info().outputPath( `${ which.replace( /\W+/g, '-' ) }.png` ), animations: 'disabled' } );
		// Approve runs blog/comments-update through core's run route, in this admin.
		const ran = page.waitForResponse( ( r ) => r.url().includes( '/wp-abilities/v1/abilities/blog/comments-update/run' ) );
		await row.getByRole( 'button', { name: 'Actions' } ).click();
		await page.getByRole( 'menuitem', { name: 'Approve' } ).click();
		expect( ( await ran ).status() ).toBe( 200 );
		await expect( page.getByText( 'Approve: done.' ) ).toBeVisible();
		const stored = await request.get( `${ site }/__first/api/v1/comments/${ id }`, { headers: auth( 'admin' ) } );
		expect( ( await stored.json() ).data.approved ).toBe( true );
	}
	expect( seen[ 'classic wp-admin' ] ).toEqual( seen[ 'First Admin' ] );
	expect( seen[ 'First Admin' ].actions ).toContain( 'Approve' );
	expect( errors ).toEqual( [] );
} );

test( 'the server decides access, the same way in both admins', async ( { page, request } ) => {
	const body = `Subscriber check ${ Date.now() }`;
	const created = await request.post( `${ site }/__first/api/v1/comments`, { headers: auth( 'admin' ), data: { postId: await post( request ), name: 'Reader', body } } );
	expect( created.status() ).toBe( 201 );
	const id = ( await created.json() ).data.id;
	await signIn( page, 'subscriber' );
	for ( const path of Object.values( hosts ) ) {
		await page.goto( `${ site }${ path }` );
		// The screen's capability is `read`; listing is the comments table's read rule (signed-in users).
		const { row } = await shown( page, body );
		const ran = page.waitForResponse( ( r ) => r.url().includes( '/wp-abilities/v1/abilities/blog/comments-update/run' ) );
		await row.getByRole( 'button', { name: 'Actions' } ).click();
		await page.getByRole( 'menuitem', { name: 'Approve' } ).click();
		// The table's update rule is "editor": the ability refuses, and the screen says so.
		expect( ( await ran ).status() ).toBe( 403 );
		await expect( page.locator( '[data-screen="test-comments"]' ).locator( '.components-notice.is-error' ) ).toBeVisible();
	}
	const stored = await request.get( `${ site }/__first/api/v1/comments/${ id }`, { headers: auth( 'admin' ) } );
	expect( ( await stored.json() ).data.approved ).toBe( false );
	// The declaration itself is refused to a user below the screen's capability, by the same route both read.
	const anonymous = await request.get( `${ site }/wp-json/first-admin/v1/screens/test-comments` );
	expect( anonymous.status() ).toBe( 401 );
} );
