import { __, _x, sprintf } from '@wordpress/i18n';
import type { Attachment, Updatable } from '@wordpress/core-data';
import type { Field } from '@typedpress-admin/dataviews';

export const fieldExtensions: Partial< Field< Updatable< Attachment > > > = {
	getValue: ( { item } ) =>
		item?.media_details?.width && item?.media_details?.height
			? sprintf(
					// translators: 1: Width. 2: Height.
					_x( '%1$s × %2$s', 'image dimensions', 'typedpress-admin' ),
					item?.media_details?.width?.toString(),
					item?.media_details?.height?.toString()
			  )
			: '',
	isVisible: ( item ) => {
		return !! ( item?.media_details?.width && item?.media_details?.height );
	},
};
