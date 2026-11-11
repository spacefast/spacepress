import { __ } from '@wordpress/i18n';
import type { Attachment, Updatable } from '@wordpress/core-data';
import type { Field } from '@first-admin/dataviews';
import { TextareaControl } from '@first-admin/design-system';
import { getRawContent } from '../utils/get-raw-content';

export const fieldExtensions: Partial< Field< Updatable< Attachment > > > = {
	getValue: ( { item } ) => getRawContent( item?.caption ),
	render: ( { item } ) => getRawContent( item?.caption ) || '-',
	Edit: ( { field, onChange, data } ) => {
		return (
			<TextareaControl
				label={ field.label }
				value={ getRawContent( data.caption ) || '' }
				onValueChange={ ( value ) => onChange( { caption: value } ) }
				rows={ 2 }
			/>
		);
	},
};
