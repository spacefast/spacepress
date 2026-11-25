import type { User } from '@wordpress/core-data';
import type { Field } from '@spacepress-admin/dataviews';

export const fieldExtensions: Partial< Field< User > > = {
	render: ( { item } ) => <span>{ item.email || '–' }</span>,
};
