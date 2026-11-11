import { ToggleControl } from '@wordpress/components';
import type { User } from '@wordpress/core-data';
import type { Field } from '@first-admin/dataviews';

export const fieldExtensions: Partial< Field< User > > = {
	getValue: ( { item } ) => ! item.syntax_highlighting,
	Edit: ( { data, field, onChange } ) => {
		return (
			<ToggleControl
				__nextHasNoMarginBottom
				label={ field.label }
				checked={ ! data.syntax_highlighting }
				onChange={ ( value ) => {
					onChange( { [ field.id ]: ! value } );
				} }
			/>
		);
	},
};
