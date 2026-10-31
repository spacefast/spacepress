import { __, _x } from '@wordpress/i18n';
import type { Field } from '@zero-admin/dataviews';
import type { MediaItem } from '../types';
import MediaAttachedToView from './view';
import MediaAttachedToEdit from './edit';
import './style.scss';

export const fieldExtensions: Partial< Field< MediaItem > > = {
	Edit: MediaAttachedToEdit,
	render: MediaAttachedToView,
	getValue: ( { item } ) => item?.post?.toString(),
};
