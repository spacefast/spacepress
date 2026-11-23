import { TextareaControl } from '@spacepress-admin/design-system';
import type { User } from '@wordpress/core-data';
import type { Field } from '@spacepress-admin/dataviews';

export const fieldExtensions: Partial< Field< User > > = {
	getValue: ( { item } ) => item.description || '',
	Edit: ( { data, field, onChange } ) => {
		return (
			<TextareaControl
				id={ field.id }
				label={ field.label }
				value={ data.description }
				description={ typeof field.description === 'string' ? field.description : undefined }
				onValueChange={ ( value ) => {
					onChange( { description: value } );
				} }
			/>
		);
	},
};
