import type { User } from '@wordpress/core-data';
import type { Field } from '@zero-admin/dataviews';

export const fieldExtensions: Partial< Field< User > > = {
	render: ( { item } ) => item.post_count || 0,
};
