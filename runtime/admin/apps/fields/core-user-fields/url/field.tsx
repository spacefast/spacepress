import { InputControl } from '@typedpress-admin/design-system';
import type { User } from '@wordpress/core-data';
import type { Field } from '@typedpress-admin/dataviews';

export const fieldExtensions: Partial< Field< User > > = {
	Edit: ( { data, field, onChange } ) => {
		return (
			<InputControl
				label={ field.label }
				type="url"
				value={ data.url }
				onValueChange={ ( value ) => {
					onChange( { url: value } );
				} }
			/>
		);
	},
};
