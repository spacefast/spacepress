import type { Post } from '@wordpress/core-data';
import type { Field, DataViewRenderFieldProps } from '@spacepress-admin/dataviews';
import { renderedText } from '../../../packages/boot/src/rendered-text';

function ExcerptField( { item }: DataViewRenderFieldProps< Post > ) {
	const excerpt = renderedText(
		typeof item.excerpt === 'string'
			? item.excerpt
			: item.excerpt?.rendered ?? ''
	);

	if ( ! excerpt ) {
		return <span className="excerpt-field__empty">—</span>;
	}

	return <div className="excerpt-field__content">{ excerpt }</div>;
}

export const fieldExtensions: Partial< Field< Post > > = {
	render: ExcerptField,
};
