import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import type { Term } from '@wordpress/core-data';
import type { Action } from '@first-admin/dataviews';

/**
 * Action to view a taxonomy term in the frontend
 */
export const viewTermAction: Action< Term > = {
	id: 'view-term',
	label: __( 'View', 'first-admin' ),
	isPrimary: false,
	supportsBulk: false,
	icon: external,
	isEligible: ( term: Term ) => !! term.link,
	callback: ( terms: Term[] ) => {
		if ( terms.length !== 1 ) {
			return;
		}
		const term = terms[ 0 ];
		if ( term.link ) {
			window.open( term.link, '_blank', 'noopener,noreferrer' );
		}
	},
};
