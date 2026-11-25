import type { Theme } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import { decodeEntities } from '@wordpress/html-entities';
import type { Field } from '@spacepress-admin/dataviews';

export function ThemeAuthor( { item }: { item: Theme } ) {
	const authorName =
		item?.author?.raw !== ''
			? decodeEntities( item.author.raw )
			: __( 'Anonymous', 'spacepress-admin' );
	if ( ! item?.author_uri?.raw ) {
		return authorName;
	}
	return <a href={ decodeEntities( item.author_uri.raw ) }>{ authorName }</a>;
}

export const fieldExtensions: Partial< Field< Theme > > = {
	getValue: ( { item }: { item: Theme } ) =>
		item?.author?.raw && item.author.raw !== ''
			? decodeEntities( item.author.raw )
			: __( 'Anonymous', 'spacepress-admin' ),
	render: ( { item }: { item: Theme } ) => <ThemeAuthor item={ item } />,
};
