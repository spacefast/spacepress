import { renderHook, act } from '@testing-library/react';
import useIsTabActive from '../use-is-tab-active';

describe( 'useIsTabActive', () => {
	let originalVisibilityState: PropertyDescriptor | undefined;

	beforeEach( () => {
		// Save the original descriptor so we can restore it.
		originalVisibilityState = Object.getOwnPropertyDescriptor(
			document,
			'visibilityState'
		);
		// Default: tab is visible.
		Object.defineProperty( document, 'visibilityState', {
			configurable: true,
			get: () => 'visible',
		} );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
		if ( originalVisibilityState ) {
			Object.defineProperty(
				document,
				'visibilityState',
				originalVisibilityState
			);
		} else {
			// JSDOM default — remove the override so the prototype value shows through.
			// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
			delete ( document as Record< string, unknown > ).visibilityState;
		}
	} );

	// -- Initial state ---------------------------------------------------

	it( 'returns true when focused and visible', () => {
		jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
		const { result } = renderHook( () => useIsTabActive() );
		expect( result.current ).toBe( true );
	} );

	it( 'returns false when the document initially lacks focus', () => {
		jest.spyOn( document, 'hasFocus' ).mockReturnValue( false );
		const { result } = renderHook( () => useIsTabActive() );
		expect( result.current ).toBe( false );
	} );

	it( 'returns false when the tab is initially hidden', () => {
		jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
		Object.defineProperty( document, 'visibilityState', {
			configurable: true,
			get: () => 'hidden',
		} );
		const { result } = renderHook( () => useIsTabActive() );
		expect( result.current ).toBe( false );
	} );

	// -- Window focus / blur ---------------------------------------------

	it( 'updates to false on window blur', () => {
		jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
		const { result } = renderHook( () => useIsTabActive() );

		act( () => {
			window.dispatchEvent( new Event( 'blur' ) );
		} );

		expect( result.current ).toBe( false );
	} );

	it( 'updates to true on window focus', () => {
		jest.spyOn( document, 'hasFocus' ).mockReturnValue( false );
		const { result } = renderHook( () => useIsTabActive() );

		act( () => {
			window.dispatchEvent( new Event( 'focus' ) );
		} );

		expect( result.current ).toBe( true );
	} );

	// -- Tab visibility --------------------------------------------------

	it( 'updates to false when the tab becomes hidden', () => {
		jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
		const { result } = renderHook( () => useIsTabActive() );
		expect( result.current ).toBe( true );

		act( () => {
			Object.defineProperty( document, 'visibilityState', {
				configurable: true,
				get: () => 'hidden',
			} );
			document.dispatchEvent( new Event( 'visibilitychange' ) );
		} );

		expect( result.current ).toBe( false );
	} );

	it( 'updates to true when the tab becomes visible again', () => {
		jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
		Object.defineProperty( document, 'visibilityState', {
			configurable: true,
			get: () => 'hidden',
		} );
		const { result } = renderHook( () => useIsTabActive() );
		expect( result.current ).toBe( false );

		act( () => {
			Object.defineProperty( document, 'visibilityState', {
				configurable: true,
				get: () => 'visible',
			} );
			document.dispatchEvent( new Event( 'visibilitychange' ) );
		} );

		expect( result.current ).toBe( true );
	} );

	// -- Combined scenarios ----------------------------------------------

	it( 'returns false when tab is visible but window is unfocused', () => {
		jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
		const { result } = renderHook( () => useIsTabActive() );
		expect( result.current ).toBe( true );

		// Window loses focus (e.g. user Alt-Tabs to another app).
		act( () => {
			window.dispatchEvent( new Event( 'blur' ) );
		} );

		expect( result.current ).toBe( false );
	} );

	it( 'returns false when window is focused but tab is hidden', () => {
		jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
		const { result } = renderHook( () => useIsTabActive() );
		expect( result.current ).toBe( true );

		// Tab becomes hidden (e.g. user switches to another browser tab).
		act( () => {
			Object.defineProperty( document, 'visibilityState', {
				configurable: true,
				get: () => 'hidden',
			} );
			document.dispatchEvent( new Event( 'visibilitychange' ) );
		} );

		expect( result.current ).toBe( false );
	} );

	it( 'requires both focus and visibility to return true', () => {
		jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
		const { result } = renderHook( () => useIsTabActive() );
		expect( result.current ).toBe( true );

		// Lose both focus and visibility.
		act( () => {
			window.dispatchEvent( new Event( 'blur' ) );
		} );
		act( () => {
			Object.defineProperty( document, 'visibilityState', {
				configurable: true,
				get: () => 'hidden',
			} );
			document.dispatchEvent( new Event( 'visibilitychange' ) );
		} );
		expect( result.current ).toBe( false );

		// Restore visibility but not focus — still inactive.
		act( () => {
			Object.defineProperty( document, 'visibilityState', {
				configurable: true,
				get: () => 'visible',
			} );
			document.dispatchEvent( new Event( 'visibilitychange' ) );
		} );
		expect( result.current ).toBe( false );

		// Restore focus — now active.
		act( () => {
			window.dispatchEvent( new Event( 'focus' ) );
		} );
		expect( result.current ).toBe( true );
	} );

	// -- Cleanup ---------------------------------------------------------

	it( 'cleans up all event listeners on unmount', () => {
		jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );

		// Capture the handlers registered by addEventListener.
		type EventHandler = ( ...args: unknown[] ) => void;
		const windowHandlers: Record< string, EventHandler > = {};
		const docHandlers: Record< string, EventHandler > = {};

		const windowAddSpy = jest
			.spyOn( window, 'addEventListener' )
			.mockImplementation( ( event, handler ) => {
				windowHandlers[ event ] = handler as EventHandler;
			} );
		const windowRemoveSpy = jest.spyOn( window, 'removeEventListener' );
		const docAddSpy = jest
			.spyOn( document, 'addEventListener' )
			.mockImplementation( ( event, handler ) => {
				docHandlers[ event ] = handler as EventHandler;
			} );
		const docRemoveSpy = jest.spyOn( document, 'removeEventListener' );

		const { unmount } = renderHook( () => useIsTabActive() );

		expect( windowAddSpy ).toHaveBeenCalledWith(
			'focus',
			expect.any( Function )
		);
		expect( windowAddSpy ).toHaveBeenCalledWith(
			'blur',
			expect.any( Function )
		);
		expect( docAddSpy ).toHaveBeenCalledWith(
			'visibilitychange',
			expect.any( Function )
		);

		unmount();

		// Verify the SAME function references are passed to remove.
		expect( windowRemoveSpy ).toHaveBeenCalledWith(
			'focus',
			windowHandlers.focus
		);
		expect( windowRemoveSpy ).toHaveBeenCalledWith(
			'blur',
			windowHandlers.blur
		);
		expect( docRemoveSpy ).toHaveBeenCalledWith(
			'visibilitychange',
			docHandlers.visibilitychange
		);
	} );
} );
