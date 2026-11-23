import { useNavigate, useParams } from '@wordpress/route';
import type { Action } from '@spacepress-admin/dataviews';
import { useMemo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { pencil } from '@wordpress/icons';
import type { Post } from '@wordpress/core-data';

/**
 * Custom hook for quick edit post action
 */
export function useQuickEditAction(): Action< Post > {
	const navigate = useNavigate();
	const { type: postType, slug } = useParams( {
		from: '/types/$type/list/$slug',
	} );

	return useMemo(
		() => ( {
			id: 'quick-edit-post',
			label: __( 'Quick Edit', 'spacepress-admin' ),
			isPrimary: true,
			icon: pencil,
			supportsBulk: true,
			isEligible( post: Post ) {
				if ( String( post.status ) === 'trash' ) {
					return false;
				}
				return true;
			},
			callback( items: Post[] ) {
				navigate( {
					to: `/types/${ postType }/list/${ slug }`,
					search: ( search: Record< string, unknown > ) => ( {
						...search,
						postIds: items.map( ( post ) => post.id.toString() ),
						edit: true,
					} ),
				} );
			},
		} ),
		[ navigate, postType, slug ]
	);
}
