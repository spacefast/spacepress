import type { User } from '@wordpress/core-data';
import { getDisplayNameItems } from '../display_name/field';

describe( 'getDisplayNameItems', () => {
	it( 'returns unique display name options', () => {
		const user: Partial< User > = {
			nickname: 'nick',
			username: 'user',
			name: 'Display Name',
			first_name: 'John',
			last_name: 'Doe',
		};
		const result = getDisplayNameItems( user as User );

		expect( result ).toEqual( [
			{ value: 'nick', label: 'nick' },
			{ value: 'user', label: 'user' },
			{ value: 'Display Name', label: 'Display Name' },
			{ value: 'John', label: 'John' },
			{ value: 'Doe', label: 'Doe' },
			{ value: 'John Doe', label: 'John Doe' },
			{ value: 'Doe John', label: 'Doe John' },
		] );
	} );

	it( 'handles missing first and last names', () => {
		const user: Partial< User > = {
			nickname: 'nick',
			username: 'user',
			name: 'Display Name',
		};
		const result = getDisplayNameItems( user as User );
		expect( result ).toEqual( [
			{ value: 'nick', label: 'nick' },
			{ value: 'user', label: 'user' },
			{ value: 'Display Name', label: 'Display Name' },
		] );
	} );

	it( 'removes duplicates', () => {
		const user: Partial< User > = {
			nickname: 'nick',
			username: 'nick',
			name: 'nick',
		};
		const result = getDisplayNameItems( user as User );
		expect( result ).toEqual( [ { value: 'nick', label: 'nick' } ] );
	} );
} );
