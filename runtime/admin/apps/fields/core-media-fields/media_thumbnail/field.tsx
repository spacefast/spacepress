import { __, _x } from '@wordpress/i18n';
import type { Field } from '@typedpress-admin/dataviews';
import type { MediaItem } from '../types';
import MediaThumbnailView from './view';
import './style.scss';

export const fieldExtensions: Partial< Field< MediaItem > > = {
	render: MediaThumbnailView,
};
