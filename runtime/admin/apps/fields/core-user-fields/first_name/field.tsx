import type { User } from '@wordpress/core-data';
import type { Field } from '@first-admin/dataviews';

export const fieldExtensions: Partial< Field< User > > = {
	render: ( { item } ) => item.first_name || '–',
};
