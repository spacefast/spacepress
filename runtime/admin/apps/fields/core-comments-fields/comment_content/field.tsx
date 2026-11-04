import type { Field } from '@zero-admin/dataviews';
import { __unstableStripHTML as stripHTML } from '@wordpress/dom';
import type { Comment } from '@wordpress/core-data';

export const fieldExtensions: Partial< Field< Comment > > = {
	getValue: ( { item } ) => item.content.raw,
	render: ( { item, field } ) => {
		const plainText = stripHTML( item.content.raw ).replace( /\s+/g, ' ' );
		return (
			<span
				style={ {
					WebkitBoxOrient: 'vertical',
					WebkitLineClamp: 5,
					display: '-webkit-box',
					overflow: 'hidden',
					whiteSpace: 'pre-wrap',
				} }
			>
				{ plainText.trim() || field.placeholder }
			</span>
		);
	},
};
