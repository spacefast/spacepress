import { useNavigate } from '@wordpress/route';
import { useViewConfig } from '@typedpress-admin/views';
import type { Action } from '@typedpress-admin/dataviews';
import { useMemo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { pencil } from '@wordpress/icons';
import type { User } from '@wordpress/core-data';

/**
 * Custom hook for the full editor user action used in the Users list view.
 */
export const useFullEditAction = (): Action< User > | null => {
	const navigate = useNavigate();
	const { actions } = useViewConfig( 'root', 'user' );
	const isEnabled =
		Array.isArray( actions ) && actions.includes( 'full_edit' );

	return useMemo( () => {
		// Don't show if disabled
		if ( ! isEnabled ) {
			return null;
		}

		return {
			id: 'full-edit-user',
			label: __( 'View', 'typedpress-admin' ),
			isPrimary: true,
			icon: pencil,
			supportsBulk: false,
			isEligible() {
				// Allow viewing all users, including invites
				return true;
			},
			callback( items: User[] ) {
				if ( items.length === 1 ) {
					navigate( {
						to: `/users/profile/${ items[ 0 ].id }`,
					} );
				}
			},
		};
	}, [ navigate, isEnabled ] );
};
