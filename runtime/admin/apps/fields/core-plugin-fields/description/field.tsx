import type { Plugin } from '@wordpress/core-data';
import type { Field } from '@zero-admin/dataviews';

export const fieldExtensions: Partial< Field< Plugin > > = {
	getValue: ( { item }: { item: Plugin } ) =>
		( item.description as any )?.raw || item.description || '',
	render: ( { item }: { item: Plugin } ) => {
		const description =
			( item.description as any )?.rendered || item.description || '';

		return <span dangerouslySetInnerHTML={ { __html: description } } />;
	},
};
