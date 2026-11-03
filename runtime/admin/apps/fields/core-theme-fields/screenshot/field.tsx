import type { Theme } from '@wordpress/core-data';
import type { Field } from '@zero-admin/dataviews';

function ThemeScreenshot( { item }: { item: Theme } ) {
	return (
		<img
			className="theme-screenshot-media"
			src={ item.screenshot }
			alt={ item.name.rendered }
		/>
	);
}

export const fieldExtensions: Partial< Field< Theme > > = {
	render: ( { item }: { item: Theme } ) => <ThemeScreenshot item={ item } />,
};
