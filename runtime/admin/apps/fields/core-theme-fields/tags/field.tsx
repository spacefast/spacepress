import type { Theme } from '@wordpress/core-data';
import { decodeEntities } from '@wordpress/html-entities';
import type { Field } from '@typedpress-admin/dataviews';
import { extractTagsFromTheme } from './utils';

export function ThemeTags( { item }: { item: Theme } ) {
	return <>{ decodeEntities( item.tags.rendered ) }</>;
}

export const fieldExtensions: Partial< Field< Theme > > = {
	getValue: ( { item }: { item: Theme } ) => extractTagsFromTheme( item ),
	render: ( { item }: { item: Theme } ) => <ThemeTags item={ item } />,
};
