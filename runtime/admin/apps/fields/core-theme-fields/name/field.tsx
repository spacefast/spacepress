import type { Theme } from '@wordpress/core-data';
import type { Field } from '@typedpress-admin/dataviews';
import ThemeNameView from './view';

export const fieldExtensions: Partial< Field< Theme > > = {
	getValue: ( { item }: { item: Theme } ) =>
		typeof item.name === 'string' ? item.name : item.name?.raw,
	render: ( { item }: { item: Theme } ) => <ThemeNameView item={ item } />,
};
