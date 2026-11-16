import type { Post } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import type { Field } from '@typedpress-admin/dataviews';
import { FeaturedImageView } from './view';
import { FeaturedImageEdit } from './edit';

export const fieldExtensions: Partial< Field< Post > > = {
	Edit: FeaturedImageEdit,
	render: FeaturedImageView,
};
