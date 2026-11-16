import { useNavigate } from '@wordpress/route';
import type { Action } from '@typedpress-admin/dataviews';
import type { Post } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import { pencil } from '@wordpress/icons';

export function useEditNavigationAction(): Action< Post > {
	const navigate = useNavigate();

	return {
		id: 'edit',
		label: __( 'Edit', 'typedpress-admin' ),
		isPrimary: true,
		icon: pencil,
		callback: ( items: Post[] ) => {
			const item = items[ 0 ];
			navigate( {
				to: `/design/navigation/edit/${ item.id }`,
			} );
		},
		isEligible( item: Post ) {
			return (
				item.type === 'wp_navigation' &&
				String( item.status ) !== 'trash'
			);
		},
	};
}
