/**
 * The visible text of HTML WordPress rendered, such as a post's
 * `excerpt.rendered`. Writers may store any markup, so the admin never inserts
 * that HTML into its DOM: it is parsed into an inert document, where nothing
 * runs or loads, and only its text comes back for React to render as text.
 */
export function renderedText( html: string ): string {
	if ( ! html ) return '';
	const document = new DOMParser().parseFromString( html, 'text/html' );
	for ( const element of document.querySelectorAll( 'script, style, template' ) ) element.remove();
	return ( document.body.textContent ?? '' ).replace( /\s+/g, ' ' ).trim();
}
