import { useEffect } from '@wordpress/element';
import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { decodeEntities } from '@wordpress/html-entities';
import { speak } from '@wordpress/a11y';
import type { UnstableBase } from '@wordpress/core-data';

export const DEFAULT_SITE_NAME = 'Zero Admin';

// Module-level flag to skip the initial page load announcement.
// A ref wouldn't work here because useDocumentTitle unmounts/remounts per route.
let hasNavigated = false;

function useSiteName(): string {
	return useSelect( ( select ) => {
		const base = select( coreStore ).getEntityRecord< UnstableBase >(
			'root',
			'__unstableBase'
		);
		return base?.name ? decodeEntities( base.name ) : DEFAULT_SITE_NAME;
	}, [] );
}

export default function useDocumentTitle( title?: string, parent?: string ) {
	const siteName = useSiteName();

	useEffect( () => {
		if ( title ) {
			const pageTitle = parent ? `${ title } \u2039 ${ parent }` : title;
			document.title = `${ pageTitle } \u2014 ${ siteName }`;

			if ( hasNavigated ) {
				speak( title, 'assertive' );
			} else {
				hasNavigated = true;
			}
		}
	}, [ title, parent, siteName ] );
}
