import type { Field } from '@spacepress-admin/dataviews';
import type { Comment } from '@wordpress/core-data';

export const fieldExtensions: Partial< Field< Comment > > = {
	getValue: ( { item } ) => {
		return item.date;
	},
};
