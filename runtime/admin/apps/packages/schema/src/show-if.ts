import type { ShowIfRule, ShowIfTest } from './types';

/**
 * Evaluate a `.showIf()` rule against the sibling values the form holds, with the semantics the
 * runtime gives SCF's conditional logic: every key of the filter must hold (including `OR`, which
 * holds when any of its alternatives does); on one sibling every operator must hold; `in` holds
 * when any option matches. A sibling absent from the values counts as empty, so `isNull` matches
 * and an equality does not.
 */
export function isShown( rule: ShowIfRule | undefined, siblings: Record< string, unknown > ): boolean {
	if ( ! rule ) {
		return true;
	}
	return Object.entries( rule ).every( ( [ key, test ] ) => {
		if ( key === 'OR' ) {
			return Array.isArray( test ) && test.some( ( alternative ) => isShown( alternative as ShowIfRule, siblings ) );
		}
		return holds( siblings[ key ], test as ShowIfTest );
	} );
}

function holds( value: unknown, test: ShowIfTest ): boolean {
	if ( test === null || typeof test !== 'object' ) {
		return test === null ? isEmpty( value ) : same( value, test );
	}
	return Object.entries( test ).every( ( [ op, arg ] ) => {
		switch ( op ) {
			case 'eq':
				return arg === null ? isEmpty( value ) : same( value, arg );
			case 'ne':
				return arg === null ? ! isEmpty( value ) : ! same( value, arg );
			case 'in':
				return Array.isArray( arg ) && arg.some( ( option ) => ( option === null ? isEmpty( value ) : same( value, option ) ) );
			case 'isNull':
				return isEmpty( value );
			case 'isNotNull':
				return ! isEmpty( value );
			default:
				return false;
		}
	} );
}

/** The runtime's emptiness: null, absent, the empty string, the empty list. */
function isEmpty( value: unknown ): boolean {
	return value === null || value === undefined || value === '' || ( Array.isArray( value ) && value.length === 0 );
}

/** Equality by meaning: a boolean stored as 0/1 or '1', a number sent as text. */
function same( a: unknown, b: unknown ): boolean {
	return scalar( a ) === scalar( b );
}

function scalar( value: unknown ): unknown {
	if ( typeof value === 'boolean' ) {
		return value ? 1 : 0;
	}
	if ( typeof value === 'string' && value !== '' && ! Number.isNaN( Number( value ) ) ) {
		return Number( value );
	}
	return value;
}
