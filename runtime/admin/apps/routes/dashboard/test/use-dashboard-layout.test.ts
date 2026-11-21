import { renderHook } from '@testing-library/react';
import { useSelect, useDispatch } from '@wordpress/data';
import type { DashboardWidget } from '@typedpress-admin/dashboard';
import { useDashboardLayout } from '../hooks';

jest.mock( '@wordpress/data' );
jest.mock( '@typedpress-admin/boot', () => ( {
	store: 'core/typedpress-admin',
} ) );

jest.mock( '@wordpress/preferences', () => ( {
	store: 'core/preferences',
} ) );

type MockStoresProps = {
	layout?: DashboardWidget< unknown >[];
	defaultLayout?: DashboardWidget< unknown >[];
};

function mockStores( { layout, defaultLayout = [] }: MockStoresProps ) {
	( useSelect as jest.Mock ).mockImplementation( ( selector ) => {
		return selector( () => ( {
			get: () => layout,
			getDashboardDefaultLayout: () => defaultLayout,
		} ) );
	} );
}

describe( 'useDashboardLayout', () => {
	const mockSet = jest.fn();

	beforeEach( () => {
		jest.clearAllMocks();
		( useDispatch as jest.Mock ).mockReturnValue( { set: mockSet } );
	} );

	it( 'falls back to default layout when preference is undefined', () => {
		const defaults = [ { uid: 'w-1', type: 'tp/content-overview' } ];
		mockStores( { layout: undefined, defaultLayout: defaults } );

		const { result } = renderHook( () => useDashboardLayout() );

		expect( result.current[ 0 ] ).toEqual( defaults );
	} );

	it( 'returns stored layout when preference exists', () => {
		const storedLayout = [
			{ uid: 'widget-1', type: 'tp/content-overview' },
			{ uid: 'widget-2', type: 'tp/recent-activity' },
		];

		mockStores( { layout: storedLayout } );

		const { result } = renderHook( () => useDashboardLayout() );

		expect( result.current[ 0 ] ).toEqual( storedLayout );
	} );

	it( 'provides setter and reset functions', () => {
		mockStores( { layout: [] } );

		const { result } = renderHook( () => useDashboardLayout() );

		expect( typeof result.current[ 1 ] ).toBe( 'function' );
		expect( typeof result.current[ 2 ] ).toBe( 'function' );
	} );

	it( 'calls preferences store set method when setting layout', () => {
		mockStores( { layout: [] } );

		const { result } = renderHook( () => useDashboardLayout() );

		const newLayout = [ { uid: 'widget-3', type: 'tp/app-status' } ];

		result.current[ 1 ]( newLayout );

		expect( mockSet ).toHaveBeenCalledWith(
			'core/admin',
			'tpDashboardLayout',
			newLayout
		);
	} );

	it( 'resets layout to default widgets from boot store', () => {
		const defaultWidgets = [
			{ uid: 'default-1', type: 'tp/content-overview' },
			{ uid: 'default-2', type: 'tp/recent-activity' },
		];

		mockStores( {
			layout: [ { uid: 'custom-1', type: 'tp/app-status' } ],
			defaultLayout: defaultWidgets,
		} );

		const { result } = renderHook( () => useDashboardLayout() );

		result.current[ 2 ]();

		expect( mockSet ).toHaveBeenCalledWith(
			'core/admin',
			'tpDashboardLayout',
			defaultWidgets
		);
	} );

	it( 'supports custom preference key and fallback layout for custom dashboards', () => {
		const customDefaults = [ { uid: 'ops-1', type: 'tp-widget/revenue' } ];
		mockStores( { layout: undefined, defaultLayout: [] } );

		const { result } = renderHook( () =>
			useDashboardLayout( 'tpDashboardLayout:ops', customDefaults )
		);

		expect( result.current[ 0 ] ).toEqual( customDefaults );
		result.current[ 2 ]();
		expect( mockSet ).toHaveBeenCalledWith(
			'core/admin',
			'tpDashboardLayout:ops',
			customDefaults
		);
	} );
} );
