import type { Field } from '@zero-admin/dataviews';
import type { Comment } from '@wordpress/core-data';

export const fieldExtensions: Partial< Field< Comment > > = {
	getValue: ( { item } ) => {
		return item.date;
	},
};
