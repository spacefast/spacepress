import { __ } from '@wordpress/i18n';
import type { User } from '@wordpress/core-data';
import type { Field } from '@typedpress-admin/dataviews';
import {
	estimatePasswordStrength,
	PasswordStrengthLevel,
} from '../util/password';

const shouldConfirmPassword = ( item: User ) => {
	if ( ! item?.password ) {
		return false;
	}
	const strength = estimatePasswordStrength( item.password );
	return (
		item.password.length > 0 &&
		! [ PasswordStrengthLevel.Strong, PasswordStrengthLevel.Good ].includes(
			strength.score
		)
	);
};

export const fieldExtensions: Partial< Field< User > > = {
	isVisible: shouldConfirmPassword,
	getValue: ( { item } ) =>
		'confirm_password' in item && item.confirm_password
			? item.confirm_password
			: '',
	isValid: {
		custom: ( item: User ) => {
			if (
				shouldConfirmPassword( item ) &&
				! ( 'confirm_password' in item && item.confirm_password )
			) {
				return __(
					'You must confirm the use of a weak password.',
					'typedpress-admin'
				);
			}

			return null;
		},
	},
};
