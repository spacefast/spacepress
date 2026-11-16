import { useNavigate } from '@wordpress/route';
import type { Action } from '@typedpress-admin/dataviews';
import { useMemo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { pencil } from '@wordpress/icons';
import type { Post } from '@wordpress/core-data';

/**
 * Custom hook for quick edit post action
 */
export function useQuickEditAction(): Action< Post > {
	const navigate = useNavigate();

	return useMemo(
		() => ( {
			id: 'quick-edit-post',
			label: __( 'Quick Edit', 'typedpress-admin' ),
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
					to: '/media',
					search: ( search: Record< string, unknown > ) => ( {
						...search,
						postIds: items.map( ( post ) => post.id.toString() ),
						edit: true,
					} ),
				} );
			},
		} ),
		[ navigate ]
	);
}
