import type { Field } from '@typedpress-admin/dataviews';
import type { Comment } from '@wordpress/core-data';
import { Badge } from '@wordpress/ui';
import { SelectControl } from '@typedpress-admin/design-system';
import { __ } from '@wordpress/i18n';

function isValidStatus( value: string ) {
	return value === 'approved' || value === 'hold' || value === 'spam';
}

const getStatusConfig = ( status: string ) => {
	if ( status === 'approved' ) {
		return {
			intent: 'none' as const,
			label: __( 'Approved', 'typedpress-admin' ),
		};
	} else if ( status === 'hold' ) {
		return {
			intent: 'low' as const,
			label: __( 'Unapproved', 'typedpress-admin' ),
		};
	} else if ( status === 'spam' ) {
		return {
			intent: 'none' as const,
			label: __( 'Spam', 'typedpress-admin' ),
		};
	} else if ( status === 'trash' ) {
		return {
			intent: 'none' as const,
			label: __( 'Trash', 'typedpress-admin' ),
		};
	}

	// For unknown statuses.
	return {
		intent: 'none' as const,
		label: __( 'Unknown', 'typedpress-admin' ),
	};
};

export const fieldExtensions: Partial< Field< Comment > > = {
	render: ( { item } ) => {
		const config = getStatusConfig( item.status );

		return <Badge intent={ config.intent }>{ config.label }</Badge>;
	},
	Edit: ( { data, field, onChange } ) => {
		return (
			<SelectControl
				label={ field.label }
				value={ data.status }
				items={
					field.elements?.filter(
						( element ) =>
							typeof element.value === 'string' &&
							isValidStatus( element.value )
					) || []
				}
				onValueChange={ ( value ) => {
					if ( value && isValidStatus( value ) ) {
						onChange( {
							// @ts-expect-error - The WP REST API returns the
							// status as 'approved' but the `Comment` type
							// expects 'approve'.
							status: value,
						} );
					}
				} }
			/>
		);
	},
};
