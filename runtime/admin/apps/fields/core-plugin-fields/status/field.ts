import type { Plugin } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import type { Field } from '@typedpress-admin/dataviews';

export const fieldExtensions: Partial< Field< Plugin > > = {
	render: ( { item }: { item: Plugin } ) => {
		switch ( item.status ) {
			case 'active':
				return __( 'Active', 'typedpress-admin' );
			case 'network-active':
				return __( 'Network Active', 'typedpress-admin' );
			default:
				return __( 'Inactive', 'typedpress-admin' );
		}
	},
};
