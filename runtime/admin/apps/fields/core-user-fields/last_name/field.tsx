import type { User } from '@wordpress/core-data';
import type { Field } from '@zero-admin/dataviews';

export const fieldExtensions: Partial< Field< User > > = {
	render: ( { item } ) => item.last_name || '–',
};
