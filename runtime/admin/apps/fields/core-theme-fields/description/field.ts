import type { Theme } from '@wordpress/core-data';
import { decodeEntities } from '@wordpress/html-entities';
import type { Field } from '@typedpress-admin/dataviews';

export const fieldExtensions: Partial< Field< Theme > > = {
	getValue: ( { item }: { item: Theme } ) => item.description.raw,
	render: ( { item }: { item: Theme } ) =>
		decodeEntities( item.description.rendered ),
};
