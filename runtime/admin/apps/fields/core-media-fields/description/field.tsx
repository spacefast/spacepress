import { __ } from '@wordpress/i18n';
import type { Attachment, Updatable } from '@wordpress/core-data';
import { TextareaControl } from '@zero-admin/design-system';
import type { Field } from '@zero-admin/dataviews';
import { getRawContent } from '../utils/get-raw-content';

export const fieldExtensions: Partial< Field< Updatable< Attachment > > > = {
	getValue: ( { item } ) => getRawContent( item?.description ),
	render: ( { item } ) => (
		<div>{ getRawContent( item?.description ) || '-' }</div>
	),
	Edit: ( { field, onChange, data } ) => {
		return (
			<TextareaControl
				label={ field.label }
				value={ getRawContent( data.description ) || '' }
				onValueChange={ ( value ) =>
					onChange( { description: value } )
				}
				rows={ 5 }
			/>
		);
	},
};
