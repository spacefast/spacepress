import type { Plugin } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import type { Field } from '@typedpress-admin/dataviews';

export const fieldExtensions: Partial< Field< Plugin > > = {
	getValue: ( { item }: { item: Plugin } ) =>
		// The REST controller exposes `recently_active` as a boolean.
		// Fallback to false if not present.
		item.recently_active ?? false,
	render: ( { item }: { item: Plugin } ) =>
		item.recently_active
			? __( 'Yes', 'typedpress-admin' )
			: __( 'No', 'typedpress-admin' ),
};
