import { Link } from '@wordpress/ui';
import type { Plugin } from '@wordpress/core-data';
import type { Field } from '@typedpress-admin/dataviews';

export const fieldExtensions: Partial< Field< Plugin > > = {
	getValue: ( { item }: { item: Plugin } ) => item.plugin_uri,
	render: ( { item }: { item: Plugin } ) => {
		if ( ! item.plugin_uri ) {
			return '-';
		}
		return (
			<Link href={ item.plugin_uri } openInNewTab>
				{ item.plugin_uri }
			</Link>
		);
	},
};
