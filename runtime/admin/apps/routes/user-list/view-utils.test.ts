/**
 * Tests for viewToQuery and getDefaultView.
 *
 * The functions under test are pure (no side effects, no hooks), so we mock
 * the heavy imports to avoid pulling in the entire WordPress data stack.
 */

jest.mock( '@typedpress-admin/views', () => ( {
	loadView: jest.fn(),
} ) );
jest.mock( '@typedpress-admin/core-data-next', () => ( {
	loadViewConfig: jest.fn(),
} ) );

import type { Filter } from '@typedpress-admin/dataviews';
import type { ViewConfig } from '@typedpress-admin/core-data-next';
import { viewToQuery, getDefaultView } from './view-utils';

describe( 'viewToQuery', () => {
	it( 'returns empty object for minimal view', () => {
		const result = viewToQuery( { type: 'table' } );
		expect( result ).toEqual( {} );
	} );

	it( 'maps perPage to per_page', () => {
		const result = viewToQuery( { type: 'table', perPage: 25 } );
		expect( result.per_page ).toBe( 25 );
	} );

	it( 'maps page', () => {
		const result = viewToQuery( { type: 'table', page: 3 } );
		expect( result.page ).toBe( 3 );
	} );

	it( 'maps search', () => {
		const result = viewToQuery( { type: 'table', search: 'john' } );
		expect( result.search ).toBe( 'john' );
	} );

	it( 'omits search when empty or whitespace', () => {
		expect(
			viewToQuery( { type: 'table', search: '' } ).search
		).toBeUndefined();
		expect(
			viewToQuery( { type: 'table', search: '   ' } ).search
		).toBeUndefined();
	} );

	it( 'maps sort field using getOrderby', () => {
		const result = viewToQuery( {
			type: 'table',
			sort: { field: 'user', direction: 'asc' },
		} );
		expect( result.orderby ).toBe( 'email' );
	} );

	it( 'maps registration_date sort field to registered_date', () => {
		const result = viewToQuery( {
			type: 'table',
			sort: { field: 'registration_date', direction: 'desc' },
		} );
		expect( result.orderby ).toBe( 'registered_date' );
		expect( result.order ).toBe( 'desc' );
	} );

	it( 'maps roles filter as string', () => {
		const result = viewToQuery( {
			type: 'table',
			filters: [
				{ field: 'roles', operator: 'is', value: 'administrator' },
			],
		} );
		expect( result.roles ).toBe( 'administrator' );
	} );

	it( 'maps roles filter with array value as comma-separated string', () => {
		const result = viewToQuery( {
			type: 'table',
			filters: [
				{
					field: 'roles',
					operator: 'isAny',
					value: [ 'administrator', 'shop_manager' ],
				},
			],
		} );
		expect( result.roles ).toBe( 'administrator,shop_manager' );
	} );

	it( 'skips roles filter with empty value', () => {
		const result = viewToQuery( {
			type: 'table',
			filters: [ { field: 'roles', operator: 'is', value: '' } ],
		} );
		expect( result.roles ).toBeUndefined();
	} );

	it( 'maps email filter with is operator', () => {
		const result = viewToQuery( {
			type: 'table',
			filters: [
				{
					field: 'email_badge',
					operator: 'is',
					value: 'test@example.com',
				},
			],
		} );
		expect( result.email_search ).toBe( 'test@example.com' );
		expect( result.email_search_not ).toBeUndefined();
	} );

	it( 'maps negated email filter to email_search_not', () => {
		const result = viewToQuery( {
			type: 'table',
			filters: [
				{
					field: 'email_badge',
					operator: 'isNot',
					value: 'spam@example.com',
				},
			],
		} );
		expect( result.email_search_not ).toBe( 'spam@example.com' );
		expect( result.email_search ).toBeUndefined();
	} );

	it( 'maps name filter with is operator', () => {
		const result = viewToQuery( {
			type: 'table',
			filters: [ { field: 'name', operator: 'is', value: 'John' } ],
		} );
		expect( result.name_search ).toBe( 'John' );
		expect( result.name_search_not ).toBeUndefined();
	} );

	it( 'maps negated name filter to name_search_not', () => {
		const result = viewToQuery( {
			type: 'table',
			filters: [
				{ field: 'name', operator: 'notContains', value: 'Bot' },
			],
		} );
		expect( result.name_search_not ).toBe( 'Bot' );
		expect( result.name_search ).toBeUndefined();
	} );

	it( 'maps date filter with "on" operator to both registered_after and registered_before', () => {
		const result = viewToQuery( {
			type: 'table',
			filters: [
				{
					field: 'registration_date',
					operator: 'on',
					value: '2025-01-15',
				},
			],
		} );
		expect( result.registered_after ).toBe( '2025-01-15' );
		expect( result.registered_before ).toBe( '2025-01-15' );
	} );

	it( 'maps date filter with "before" operator', () => {
		const result = viewToQuery( {
			type: 'table',
			filters: [
				{
					field: 'registration_date',
					operator: 'before',
					value: '2025-02-01',
				},
			],
		} );
		expect( result.registered_before ).toBe( '2025-02-01' );
		expect( result.registered_after ).toBeUndefined();
	} );

	it( 'maps date filter with "after" operator', () => {
		const result = viewToQuery( {
			type: 'table',
			filters: [
				{
					field: 'registration_date',
					operator: 'after',
					value: '2025-01-01',
				},
			],
		} );
		expect( result.registered_after ).toBe( '2025-01-01' );
		expect( result.registered_before ).toBeUndefined();
	} );

	it( 'maps date filter with "between" operator', () => {
		const result = viewToQuery( {
			type: 'table',
			filters: [
				{
					field: 'registration_date',
					operator: 'between',
					value: [ '2025-01-01', '2025-01-31' ],
				},
			],
		} );
		expect( result.registered_after ).toBe( '2025-01-01' );
		expect( result.registered_before ).toBe( '2025-01-31' );
	} );

	it( 'skips date filter with non-array value for "between" operator', () => {
		const result = viewToQuery( {
			type: 'table',
			filters: [
				{
					field: 'registration_date',
					operator: 'between',
					value: '2025-01-01',
				},
			],
		} );
		expect( result.registered_after ).toBeUndefined();
		expect( result.registered_before ).toBeUndefined();
	} );

	it( 'skips filters with empty value', () => {
		const result = viewToQuery( {
			type: 'table',
			filters: [
				{ field: 'email_badge', operator: 'is', value: '' },
				{
					field: 'name',
					operator: 'is',
					value: undefined as unknown as string,
				},
			],
		} );
		expect( result.email_search ).toBeUndefined();
		expect( result.name_search ).toBeUndefined();
	} );

	it( 'handles multiple filters simultaneously', () => {
		const result = viewToQuery( {
			type: 'table',
			perPage: 20,
			page: 1,
			search: 'admin',
			sort: { field: 'registration_date', direction: 'desc' },
			filters: [
				{ field: 'roles', operator: 'is', value: 'administrator' },
				{ field: 'email_badge', operator: 'is', value: 'example.com' },
				{ field: 'name', operator: 'is', value: 'John' },
				{
					field: 'registration_date',
					operator: 'after',
					value: '2025-01-01',
				},
			],
		} );

		expect( result ).toMatchObject( {
			per_page: 20,
			page: 1,
			search: 'admin',
			orderby: 'registered_date',
			order: 'desc',
			roles: 'administrator',
			email_search: 'example.com',
			name_search: 'John',
			registered_after: '2025-01-01',
		} );
	} );

	it( 'recognizes isNone as negated operator', () => {
		const result = viewToQuery( {
			type: 'table',
			filters: [
				{ field: 'email_badge', operator: 'isNone', value: 'test' },
			],
		} );
		expect( result.email_search_not ).toBe( 'test' );
	} );
} );

describe( 'getDefaultView', () => {
	it( 'returns default view when no viewConfig', () => {
		const view = getDefaultView( 'all', null );
		expect( view.type ).toBe( 'table' );
		expect( view.perPage ).toBe( 20 );
		expect( view.filters ).toEqual( [] );
	} );

	it( 'adds locked role filter for non-all slugs', () => {
		const view = getDefaultView( 'administrator', null );
		const roleFilter = view.filters?.find(
			( f: Filter ) => f.field === 'roles'
		);
		expect( roleFilter ).toBeDefined();
		expect( roleFilter?.value ).toBe( 'administrator' );
		expect( roleFilter?.isLocked ).toBe( true );
	} );

	it( 'uses viewConfig default_view when provided', () => {
		const viewConfig = {
			default_view: {
				type: 'table' as const,
				perPage: 50,
				filters: [],
			},
		} as ViewConfig;

		const view = getDefaultView( 'all', viewConfig );
		expect( view.perPage ).toBe( 50 );
	} );

	it( 'merges tab filters with locked flag', () => {
		const viewConfig = {
			default_view: {
				type: 'table' as const,
				perPage: 20,
				filters: [],
			},
			tabs: [
				{
					slug: 'shop_manager',
					filters: [
						{
							field: 'roles',
							operator: 'is',
							value: 'shop_manager',
						},
					],
				},
			],
		} as ViewConfig;

		const view = getDefaultView( 'shop_manager', viewConfig );
		const roleFilter = view.filters?.find(
			( f: Filter ) => f.field === 'roles'
		);
		expect( roleFilter?.isLocked ).toBe( true );
		expect( roleFilter?.value ).toBe( 'shop_manager' );
	} );

	it( 'defaults slug to "all" when undefined', () => {
		const view = getDefaultView( undefined, null );
		expect( view.filters ).toEqual( [] );
	} );
} );
