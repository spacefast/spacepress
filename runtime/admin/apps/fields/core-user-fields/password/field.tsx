import { Button, IconButton } from '@wordpress/ui';
// eslint-disable-next-line @zero-admin/design-system/use-new-components -- See: ARC-1359
import { InputControl, InputLayout } from '@zero-admin/design-system';
import { __ } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import { seen, unseen } from '@wordpress/icons';
import { Flex } from '@wordpress/components';
import type { User } from '@wordpress/core-data';
import type { Field } from '@zero-admin/dataviews';
import { estimatePasswordStrength } from '../util/password';
import './style.scss';

function generatePassword(
	length = 24,
	specialChars = true,
	extraSpecialChars = false
): string {
	let chars =
		'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	if ( specialChars ) {
		chars += '!@#$%^&*()';
	}
	if ( extraSpecialChars ) {
		chars += '-_ []{}<>~`+=,.;:/?|';
	}

	let password = '';
	const array = new Uint32Array( length );
	crypto.getRandomValues( array );

	for ( let i = 0; i < length; i++ ) {
		password += chars.charAt( array[ i ] % chars.length );
	}

	return password;
}

function PasswordStrengthMeter( { password }: { password: string } ) {
	const strength = estimatePasswordStrength( password );
	const scoreToWidth: Record< number, number > = { 2: 25, 3: 50, 4: 100 };
	const widthPercent = scoreToWidth[ strength.score ] ?? 0;

	if ( ! password ) {
		return null;
	}

	return (
		<Flex
			className="fields-controls__password-strength-container"
			justify="flex-start"
			align="center"
			gap={ 2 }
		>
			<div className="fields-controls__password-strength-meter">
				<div
					style={ {
						width: `${ widthPercent }%`,
						backgroundColor: strength.color,
					} }
				/>
			</div>
			<span
				style={ {
					color: strength.color,
				} }
			>
				{ strength.label }
			</span>
		</Flex>
	);
}

export const fieldExtensions: Partial< Field< User > > = {
	Edit: ( { data, field, onChange } ) => {
		const [ show, setShow ] = useState( false );
		const password = data?.password ?? '';

		const handleGeneratePassword = () => {
			setShow( true );
			const newPassword = generatePassword();
			onChange( { password: newPassword } );
		};

		return (
			<>
				<InputControl
					required={ field.isValid?.required?.constraint }
					className="fields-controls__password"
					label={ field.label }
					type={ show ? 'text' : 'password' }
					value={ password }
					onChange={ ( e ) => {
						onChange( { [ field.id ]: e.target.value } );
					} }
					suffix={
						<InputLayout.Slot padding="minimal">
							<IconButton
								label={
									show
										? __( 'Hide password', 'zero-admin' )
										: __( 'Show password', 'zero-admin' )
								}
								onClick={ () => setShow( ! show ) }
								icon={ show ? unseen : seen }
								size="small"
								variant="minimal"
								tone="neutral"
							/>
						</InputLayout.Slot>
					}
				/>
				<PasswordStrengthMeter password={ password } />
				<Button
					className="fields-controls__password-generate"
					variant="outline"
					onClick={ handleGeneratePassword }
				>
					{ __( 'Generate', 'zero-admin' ) }
				</Button>
			</>
		);
	},
};
