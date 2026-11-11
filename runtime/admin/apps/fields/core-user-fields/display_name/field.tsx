import { SelectControl } from '@first-admin/design-system';
import { __ } from '@wordpress/i18n';
import type { User } from '@wordpress/core-data';
import type { Field } from '@first-admin/dataviews';

export const getDisplayNameItems = ( item: User ) => {
	const items = [ item.nickname, item.username, item.name ];

	if ( item.first_name ) {
		items.push( item.first_name );
	}
	if ( item.last_name ) {
		items.push( item.last_name );
	}
	if ( item.first_name && item.last_name ) {
		items.push( `${ item.first_name } ${ item.last_name }` );
		items.push( `${ item.last_name } ${ item.first_name }` );
	}

	return [ ...new Set( items ) ].map( ( currentItem ) => ( {
		value: currentItem,
		label: currentItem,
	} ) );
};

export const fieldExtensions: Partial< Field< User > > = {
	Edit: ( { data, field, onChange } ) => {
		return (
			<SelectControl
				label={ field.label }
				value={ data.name }
				items={ getDisplayNameItems( data ) }
				onValueChange={ ( value ) => {
					// Field ID is 'display_name' but we need to update 'name' property.
					// @ts-expect-error TODO: Value can be null.
					onChange( { name: value } );
				} }
			/>
		);
	},
};
