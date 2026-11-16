import { useNavigate } from '@wordpress/route';
import type { Action } from '@typedpress-admin/dataviews';
import { useMemo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { pencil } from '@wordpress/icons';
import type { Post } from '@wordpress/core-data';

/**
 * Custom hook for full editor post action
 */
export function useFullEditAction(): Action< Post > {
	const navigate = useNavigate();

	return useMemo(
		() => ( {
			id: 'full-edit-post',
			label: __( 'Edit', 'typedpress-admin' ),
			isPrimary: true,
			icon: pencil,
			supportsBulk: false,
			isEligible( post: Post ) {
				if ( String( post.status ) === 'trash' ) {
					return false;
				}
				return true;
			},
			callback( items: Post[] ) {
				if ( items.length === 1 ) {
					navigate( {
						to: `/media/${ items[ 0 ].id }`,
					} );
				}
			},
		} ),
		[ navigate ]
	);
}
