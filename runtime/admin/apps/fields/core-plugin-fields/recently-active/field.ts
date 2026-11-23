import type { Plugin } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import type { Field } from '@spacepress-admin/dataviews';

export const fieldExtensions: Partial< Field< Plugin > > = {
	getValue: ( { item }: { item: Plugin } ) =>
		// The REST controller exposes `recently_active` as a boolean.
		// Fallback to false if not present.
		item.recently_active ?? false,
	render: ( { item }: { item: Plugin } ) =>
		item.recently_active
			? __( 'Yes', 'spacepress-admin' )
			: __( 'No', 'spacepress-admin' ),
};
