import { __ } from '@wordpress/i18n';
import { decodeEntities } from '@wordpress/html-entities';
import type { Term } from '@wordpress/core-data';
import type { Field } from '@typedpress-admin/dataviews';

export const fieldExtensions: Partial< Field< Term > > = {
	render: ( { item } ) => decodeEntities( item.name ),
};
