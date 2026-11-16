import { dateI18n } from '@wordpress/date';
import type { User } from '@wordpress/core-data';
import type { Field } from '@typedpress-admin/dataviews';

export const fieldExtensions: Partial< Field< User > > = {
	getValue: ( { item } ) => item.registered_date,
	render: ( { item } ) => {
		if ( ! item.registered_date ) {
			return '—';
		}
		return dateI18n( 'M j, Y', item.registered_date );
	},
};
