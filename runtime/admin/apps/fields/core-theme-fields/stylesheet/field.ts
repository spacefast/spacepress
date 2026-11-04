import type { Theme } from '@wordpress/core-data';
import type { Field } from '@zero-admin/dataviews';

export const fieldExtensions: Partial< Field< Theme > > = {
	getValue: ( { item }: { item: Theme } ) => item.stylesheet || '',
};
