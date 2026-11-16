import type { Plugin } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import type { Field } from '@typedpress-admin/dataviews';

export const fieldExtensions: Partial< Field< Plugin > > = {
	getValue: ( { item: plugin }: { item: Plugin } ) => plugin.update_available,
	render: ( { item: plugin }: { item: Plugin } ) =>
		plugin.update_available
			? __( 'Yes', 'typedpress-admin' )
			: __( 'No', 'typedpress-admin' ),
};
