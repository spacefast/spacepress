import { useParams } from '@wordpress/route';
import { useMemo } from '@wordpress/element';
import type { Term } from '@wordpress/core-data';
import type { Action } from '@first-admin/dataviews';
import { useDeleteTermAction } from './delete-term';
import { useFullEditTermAction } from './full-edit-term';
import { viewTermAction } from './view-term';

export function useTaxonomyTermsActions() {
	const { taxonomy }: { taxonomy: string } = useParams( {
		from: '/types/$type/taxonomies/$taxonomy',
	} );
	const deleteTermAction = useDeleteTermAction( taxonomy );
	const fullEditTermAction = useFullEditTermAction();

	return useMemo(
		() =>
			[ viewTermAction, fullEditTermAction, deleteTermAction ].filter(
				( action ): action is Action< Term > => !! action
			),
		[ fullEditTermAction, deleteTermAction ]
	);
}
