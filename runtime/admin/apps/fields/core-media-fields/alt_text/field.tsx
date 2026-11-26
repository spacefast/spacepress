import { TextareaControl } from '@spacepress-admin/design-system';
import type { Field } from '@spacepress-admin/dataviews';
import type { Attachment, Updatable } from '@wordpress/core-data';

export const fieldExtensions: Partial< Field< Updatable< Attachment > > > = {
	isVisible: ( item ) => item?.media_type === 'image',
	render: ( { item } ) => item?.alt_text || '-',
	Edit: ( { field, onChange, data } ) => {
		return (
			<TextareaControl
				label={ field.label }
				value={ data.alt_text || '' }
				onValueChange={ ( value ) => onChange( { alt_text: value } ) }
				rows={ 2 }
			/>
		);
	},
};
