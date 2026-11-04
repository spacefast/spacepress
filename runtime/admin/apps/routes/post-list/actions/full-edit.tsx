import { useNavigate, useParams } from '@wordpress/route';
import type { Action } from '@zero-admin/dataviews';
import { useMemo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { pencil } from '@wordpress/icons';
import type { Post } from '@wordpress/core-data';

/**
 * Custom hook for full editor post action
 */
export function useFullEditAction(): Action< Post > {
	const navigate = useNavigate();
	const { type: postType } = useParams( { from: '/types/$type/list/$slug' } );

	return useMemo(
		() => ( {
			id: 'full-edit-post',
			label: __( 'Edit', 'zero-admin' ),
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
						to: `/types/${ postType }/edit/${ items[ 0 ].id }`,
					} );
				}
			},
		} ),
		[ navigate, postType ]
	);
}
