import type { Plugin } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import type { Field } from '@spacepress-admin/dataviews';

export const fieldExtensions: Partial< Field< Plugin > > = {
	getValue: ( { item }: { item: Plugin } ) => item.auto_update,
	render: ( { item }: { item: Plugin } ) =>
		item.auto_update
			? __( 'Enabled', 'spacepress-admin' )
			: __( 'Disabled', 'spacepress-admin' ),
};
