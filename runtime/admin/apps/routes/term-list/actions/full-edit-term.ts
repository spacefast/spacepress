import { useNavigate, useParams } from '@wordpress/route';
import { useViewConfig } from '@typedpress-admin/views';
import { store as coreStore } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { useMemo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { pencil } from '@wordpress/icons';
import type { Action } from '@typedpress-admin/dataviews';
import type { Term } from '@wordpress/core-data';

/**
 * Custom hook for navigating to the full term editor.
 */
export function useFullEditTermAction(): Action< Term > | null {
	const navigate = useNavigate();
	const { type, taxonomy }: { type: string; taxonomy: string } = useParams( {
		from: '/types/$type/taxonomies/$taxonomy',
	} );

	const { actions } = useViewConfig( 'taxonomy', taxonomy );
	const isEnabled =
		Array.isArray( actions ) && actions.includes( 'full_edit' );

	const canEditTerms = useSelect(
		( select ) =>
			select( coreStore ).canUser( 'create', {
				kind: 'taxonomy',
				name: taxonomy,
			} ),
		[ taxonomy ]
	);

	return useMemo( () => {
		if ( ! isEnabled ) {
			return null;
		}

		return {
			id: 'full-edit-term',
			label: __( 'Edit', 'typedpress-admin' ),
			isPrimary: true,
			icon: pencil,
			supportsBulk: false,
			isEligible() {
				return !! canEditTerms;
			},
			callback( items: Term[] ) {
				if ( items.length !== 1 ) {
					return;
				}

				void navigate( {
					to: '/types/$type/taxonomies/$taxonomy/edit/$termId',
					params: {
						type,
						taxonomy,
						termId: items[ 0 ].id.toString(),
					},
				} );
			},
		};
	}, [ navigate, isEnabled, type, taxonomy, canEditTerms ] );
}
