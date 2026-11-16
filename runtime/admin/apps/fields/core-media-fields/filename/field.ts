import { __ } from '@wordpress/i18n';
import { getFilename } from '@wordpress/url';
import type { Field } from '@typedpress-admin/dataviews';
import type { MediaItem } from '../types';
import FileNameView from './view';

export const fieldExtensions: Partial< Field< MediaItem > > = {
	getValue: ( { item }: { item: MediaItem } ) =>
		getFilename( item?.source_url || '' ),
	render: FileNameView,
};
