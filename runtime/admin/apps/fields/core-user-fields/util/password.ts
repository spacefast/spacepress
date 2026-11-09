import { __ } from '@wordpress/i18n';

export enum PasswordStrengthLevel {
	Unknown = -1,
	Short = 0,
	Weak = 2,
	Good = 3,
	Strong = 4,
}

export interface PasswordStrength {
	score: number;
	label: string;
	color: string;
}

export function getPasswordStrength( password: string ): number {
	if ( typeof password !== 'string' ) {
		return PasswordStrengthLevel.Unknown;
	}

	// Short or empty password triggers 'short' case (5)
	if ( ! password || password.length < 6 ) {
		return PasswordStrengthLevel.Short;
	}

	// --- Estimate alphabet size (keyspace) from classes present ---
	// Lowercase a-z (26), Uppercase A-Z (26), Digits 0-9 (10),
	// Symbols (roughly printable non-alnum; we'll approximate as 33).
	let alphabet = 0;
	if ( /[a-z]/.test( password ) ) {
		alphabet += 26;
	}
	if ( /[A-Z]/.test( password ) ) {
		alphabet += 26;
	}
	if ( /\d/.test( password ) ) {
		alphabet += 10;
	}
	if ( /[^A-Za-z0-9]/.test( password ) ) {
		alphabet += 33;
	}

	// Fallback in odd cases (e.g., only one repeated char)
	if ( alphabet === 0 ) {
		alphabet = Math.min( new Set( password ).size, 1 ) || 1;
	}

	// --- Entropy in bits ---
	const entropy = password.length * Math.log2( alphabet );

	// --- Thresholds (tweakable) ---
	// < ~40 bits: WEAK for offline guessing with commodity hardware.
	// 40–64 bits: GOOD (resistant to most practical attacks).
	// >= 64 bits: STRONG.
	if ( entropy >= 64 ) {
		return PasswordStrengthLevel.Strong;
	}
	if ( entropy >= 40 ) {
		return PasswordStrengthLevel.Good;
	}
	return PasswordStrengthLevel.Weak;
}

export const estimatePasswordStrength = (
	password: string
): PasswordStrength => {
	if ( ! password ) {
		return { score: 0, label: '', color: '#ccc' };
	}

	const strengthLevel = getPasswordStrength( password );

	// Map WordPress strength levels to our display values
	switch ( strengthLevel ) {
		case -1:
			return {
				score: -1,
				label: __( 'Unknown', 'first-admin' ),
				color: '#dc3232',
			};
		case 2:
			return {
				score: 2,
				label: __( 'Weak', 'first-admin' ),
				color: '#dc3232',
			};
		case 3:
			return {
				score: 3,
				label: __( 'Good', 'first-admin' ),
				color: '#f56e28',
			};
		case 4:
			return {
				score: 4,
				label: __( 'Strong', 'first-admin' ),
				color: '#46b450',
			};
		default:
			return {
				score: 0,
				label: __( 'Short', 'first-admin' ),
				color: '#dc3232',
			};
	}
};

export const generatePassword = (
	length = 24,
	specialChars = true,
	extraSpecialChars = false
): string => {
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
};
