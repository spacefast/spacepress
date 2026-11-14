import { expect, type Page } from '@playwright/test';

/**
 * Fills WordPress's sign-in form on the page that is open and submits it.
 *
 * wp-login.php focuses and selects its username field 200 ms after it loads. Playwright's `fill`
 * focuses a field and then inserts the text into whatever has focus, so when that timer fires in
 * between, the password is typed over the username and the password stays empty; the browser then
 * refuses to submit the form. So both fields are filled until both hold what was typed.
 */
export async function submitSignIn( page: Page, username: string, password: string ): Promise< void > {
	const user = page.locator( '#user_login' );
	const pass = page.locator( '#user_pass' );
	await expect( async () => {
		await user.fill( username );
		await pass.fill( password );
		await expect( user ).toHaveValue( username, { timeout: 250 } );
		await expect( pass ).toHaveValue( password, { timeout: 250 } );
	} ).toPass( { timeout: 15000 } );
	await page.locator( '#wp-submit' ).click();
}
