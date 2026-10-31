import { renderHook, act } from '@testing-library/react';
import useTabActiveInterval from '../use-tab-active-interval';

describe( 'useTabActiveInterval', () => {
	let originalVisibilityState: PropertyDescriptor | undefined;

	beforeEach( () => {
		jest.useFakeTimers();
		jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
		originalVisibilityState = Object.getOwnPropertyDescriptor(
			document,
			'visibilityState'
		);
		Object.defineProperty( document, 'visibilityState', {
			configurable: true,
			get: () => 'visible',
		} );
	} );

	afterEach( () => {
		jest.useRealTimers();
		jest.restoreAllMocks();
		if ( originalVisibilityState ) {
			Object.defineProperty(
				document,
				'visibilityState',
				originalVisibilityState
			);
		} else {
			// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
			delete ( document as Record< string, unknown > ).visibilityState;
		}
	} );

	it( 'calls callback immediately when focused', () => {
		const callback = jest.fn();
		renderHook( () => useTabActiveInterval( callback, 10 ) );

		expect( callback ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'calls callback at each interval', () => {
		const callback = jest.fn();
		renderHook( () => useTabActiveInterval( callback, 10 ) );

		// Initial call.
		expect( callback ).toHaveBeenCalledTimes( 1 );

		act( () => {
			jest.advanceTimersByTime( 10_000 );
		} );
		expect( callback ).toHaveBeenCalledTimes( 2 );

		act( () => {
			jest.advanceTimersByTime( 10_000 );
		} );
		expect( callback ).toHaveBeenCalledTimes( 3 );
	} );

	it( 'does not call callback when unfocused', () => {
		jest.spyOn( document, 'hasFocus' ).mockReturnValue( false );
		const callback = jest.fn();
		renderHook( () => useTabActiveInterval( callback, 10 ) );

		act( () => {
			jest.advanceTimersByTime( 30_000 );
		} );

		expect( callback ).not.toHaveBeenCalled();
	} );

	it( 'stops interval on blur and resumes on focus', () => {
		const callback = jest.fn();
		renderHook( () => useTabActiveInterval( callback, 10 ) );

		// Initial call on mount.
		expect( callback ).toHaveBeenCalledTimes( 1 );

		// Blur — interval should stop.
		act( () => {
			window.dispatchEvent( new Event( 'blur' ) );
		} );

		act( () => {
			jest.advanceTimersByTime( 30_000 );
		} );
		expect( callback ).toHaveBeenCalledTimes( 1 );

		// Focus — should call immediately and restart interval.
		act( () => {
			window.dispatchEvent( new Event( 'focus' ) );
		} );
		expect( callback ).toHaveBeenCalledTimes( 2 );

		act( () => {
			jest.advanceTimersByTime( 10_000 );
		} );
		expect( callback ).toHaveBeenCalledTimes( 3 );
	} );

	it( 'stops interval when tab becomes hidden and resumes when visible', () => {
		const callback = jest.fn();
		renderHook( () => useTabActiveInterval( callback, 10 ) );

		// Initial call on mount.
		expect( callback ).toHaveBeenCalledTimes( 1 );

		// Tab becomes hidden — interval should stop.
		act( () => {
			Object.defineProperty( document, 'visibilityState', {
				configurable: true,
				get: () => 'hidden',
			} );
			document.dispatchEvent( new Event( 'visibilitychange' ) );
		} );

		act( () => {
			jest.advanceTimersByTime( 30_000 );
		} );
		expect( callback ).toHaveBeenCalledTimes( 1 );

		// Tab becomes visible — should call immediately and restart interval.
		act( () => {
			Object.defineProperty( document, 'visibilityState', {
				configurable: true,
				get: () => 'visible',
			} );
			document.dispatchEvent( new Event( 'visibilitychange' ) );
		} );
		expect( callback ).toHaveBeenCalledTimes( 2 );

		act( () => {
			jest.advanceTimersByTime( 10_000 );
		} );
		expect( callback ).toHaveBeenCalledTimes( 3 );
	} );

	it( 'does not restart interval when callback identity changes', () => {
		const callback1 = jest.fn();
		const callback2 = jest.fn();

		const { rerender } = renderHook(
			( { cb } ) => useTabActiveInterval( cb, 10 ),
			{ initialProps: { cb: callback1 } }
		);

		// Initial call with callback1.
		expect( callback1 ).toHaveBeenCalledTimes( 1 );

		// Advance partway through the interval.
		act( () => {
			jest.advanceTimersByTime( 5_000 );
		} );

		// Swap callback — should NOT restart interval.
		rerender( { cb: callback2 } );

		// Complete the original interval period.
		act( () => {
			jest.advanceTimersByTime( 5_000 );
		} );

		// callback2 should be called by the existing interval (not restarted).
		expect( callback2 ).toHaveBeenCalledTimes( 1 );
		// callback1 should not have been called again after the swap.
		expect( callback1 ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'restarts interval when intervalInSeconds changes', () => {
		const callback = jest.fn();
		const { rerender } = renderHook(
			( { interval } ) => useTabActiveInterval( callback, interval ),
			{ initialProps: { interval: 10 } }
		);

		// Initial call on mount.
		expect( callback ).toHaveBeenCalledTimes( 1 );

		// Advance partway through the first interval.
		act( () => {
			jest.advanceTimersByTime( 5_000 );
		} );
		expect( callback ).toHaveBeenCalledTimes( 1 );

		// Change interval — effect tears down and restarts, calling immediately.
		rerender( { interval: 20 } );
		expect( callback ).toHaveBeenCalledTimes( 2 );

		// Old 10s cadence should not fire.
		act( () => {
			jest.advanceTimersByTime( 10_000 );
		} );
		expect( callback ).toHaveBeenCalledTimes( 2 );

		// New 20s cadence fires.
		act( () => {
			jest.advanceTimersByTime( 10_000 );
		} );
		expect( callback ).toHaveBeenCalledTimes( 3 );
	} );

	it( 'clamps interval to a minimum of 1 second', () => {
		const callback = jest.fn();
		renderHook( () => useTabActiveInterval( callback, 0 ) );

		// Initial call on mount.
		expect( callback ).toHaveBeenCalledTimes( 1 );

		// Should not fire at sub-second intervals.
		act( () => {
			jest.advanceTimersByTime( 500 );
		} );
		expect( callback ).toHaveBeenCalledTimes( 1 );

		// Fires after 1 second (the enforced minimum).
		act( () => {
			jest.advanceTimersByTime( 500 );
		} );
		expect( callback ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'clears interval on unmount', () => {
		const callback = jest.fn();
		const { unmount } = renderHook( () =>
			useTabActiveInterval( callback, 10 )
		);

		expect( callback ).toHaveBeenCalledTimes( 1 );

		unmount();

		act( () => {
			jest.advanceTimersByTime( 30_000 );
		} );
		expect( callback ).toHaveBeenCalledTimes( 1 );
	} );
} );
