import { useNavigate, useParams } from '@wordpress/route';
import { useViewConfig } from '@zero-admin/views';
import type { Action } from '@zero-admin/dataviews';
import { useMemo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { pencil } from '@wordpress/icons';
import type { User } from '@wordpress/core-data';

/**
 * Custom hook for the quick-edit user action used in the Users list view.
 */
export const useQuickEditAction = (): Action< User > | null => {
	const navigate = useNavigate();
	const { slug } = useParams( {
		from: '/users/list/$slug',
	} );

	const { viewConfig, actions } = useViewConfig( 'root', 'user' );
	const isEnabled =
		Array.isArray( actions ) && actions.includes( 'quick_edit' );

	return useMemo( () => {
		// Don't show if disabled or if quick_edit_form is null
		if ( ! isEnabled || ! viewConfig?.quick_edit_form ) {
			return null;
		}

		return {
			id: 'quick-edit-user',
			label: __( 'Quick Edit', 'zero-admin' ),
			isPrimary: true,
			icon: pencil,
			supportsBulk: true,
			isEligible( _user: User ) {
				return true;
			},
			callback( items: User[] ) {
				navigate( {
					to: `/users/list/${ slug }`,
					search: ( search: Record< string, unknown > ) => ( {
						...search,
						userIds: items.map( ( user ) => user.id ),
						edit: true,
					} ),
				} );
			},
		};
	}, [ navigate, slug, isEnabled, viewConfig?.quick_edit_form ] );
};
