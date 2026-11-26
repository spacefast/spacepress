import type { Post } from '@wordpress/core-data';
import type { Field } from '@spacepress-admin/dataviews';

export const fieldExtensions: Partial< Field< Post > > = {
	getValue: ( post: any ) => {
		if ( post.item.date === null ) {
			return 'no set';
		}
		const date = new Date( post.item.date );
		return date.getFullYear().toString();
	},
};
