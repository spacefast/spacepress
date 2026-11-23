import { InputControl } from '@spacepress-admin/design-system';
import { __ } from '@wordpress/i18n';
import type { User } from '@wordpress/core-data';
import type { Field } from '@spacepress-admin/dataviews';

export const fieldExtensions: Partial< Field< User > > = {
	sort: ( a, b, direction ) => {
		const aUsername = a.username || a.slug;
		const bUsername = b.username || b.slug;
		return direction === 'asc'
			? aUsername.localeCompare( bUsername )
			: bUsername.localeCompare( aUsername );
	},
	getValue: ( { item } ) => item.username || item.slug,
	Edit: ( { data, field, onChange } ) => {
		const isEditable = ! data.id;
		return (
			<InputControl
				label={ field.label }
				type="text"
				disabled={ ! isEditable }
				value={ data.username || data.slug || '' }
				onValueChange={ ( value ) => {
					onChange( { username: value } );
				} }
				description={
					! isEditable
						? __( 'Usernames cannot be changed', 'spacepress-admin' )
						: ''
				}
			/>
		);
	},
};
