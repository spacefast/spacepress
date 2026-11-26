import { renderHook, act } from '@testing-library/react';
import useAutoRefresh from '../use-auto-refresh';

// Mock @wordpress/core-data
jest.mock( '@wordpress/core-data', () => ( {
	store: 'core',
} ) );

// Mock @wordpress/a11y
const mockSpeak = jest.fn();
jest.mock( '@wordpress/a11y', () => ( {
	speak: ( ...args: unknown[] ) => mockSpeak( ...args ),
} ) );

// Mock @wordpress/data — stable dispatch object to prevent useCallback invalidation.
const mockInvalidateResolution = jest.fn();
const mockDispatch = { invalidateResolution: mockInvalidateResolution };
jest.mock( '@wordpress/data', () => ( {
	useDispatch: () => mockDispatch,
} ) );

describe( 'useAutoRefresh', () => {
	beforeEach( () => {
		jest.useFakeTimers();
		mockInvalidateResolution.mockClear();
		mockSpeak.mockClear();
		// Default: window is focused.
		jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
	} );

	afterEach( () => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	} );

	const defaultProps = {
		kind: 'root',
		name: 'order',
		query: { per_page: 20, page: 1 },
		isResolving: false,
	};

	describe( 'isAutoRefreshing', () => {
		it( 'returns false by default', () => {
			const { result } = renderHook( () =>
				useAutoRefresh( defaultProps )
			);
			expect( result.current.isAutoRefreshing ).toBe( false );
		} );

		it( 'returns true during background auto-refresh', () => {
			const { result, rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{
					initialProps: {
						...defaultProps,
						intervalSeconds: 10,
					},
				}
			);

			// Trigger auto-refresh via timer.
			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );

			// Core-data starts resolving.
			rerender( {
				...defaultProps,
				isResolving: true,
				intervalSeconds: 10,
			} );
			expect( result.current.isAutoRefreshing ).toBe( true );
		} );

		it( 'returns true during focus-regain refresh', () => {
			const { result, rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{ initialProps: defaultProps }
			);

			act( () => {
				window.dispatchEvent( new Event( 'blur' ) );
			} );
			act( () => {
				window.dispatchEvent( new Event( 'focus' ) );
			} );

			rerender( { ...defaultProps, isResolving: true } );
			expect( result.current.isAutoRefreshing ).toBe( true );
		} );

		it( 'clears once resolution settles', () => {
			const { result, rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{
					initialProps: {
						...defaultProps,
						intervalSeconds: 10,
					},
				}
			);

			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );

			rerender( {
				...defaultProps,
				isResolving: true,
				intervalSeconds: 10,
			} );
			expect( result.current.isAutoRefreshing ).toBe( true );

			// Resolution settles — effect clears the ref.
			rerender( {
				...defaultProps,
				isResolving: false,
				intervalSeconds: 10,
			} );
			// Ref was cleared in the effect; re-render to read the new value.
			rerender( {
				...defaultProps,
				isResolving: false,
				intervalSeconds: 10,
			} );
			expect( result.current.isAutoRefreshing ).toBe( false );
		} );

		it( 'clears when query changes', () => {
			const { result, rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{
					initialProps: {
						...defaultProps,
						intervalSeconds: 10,
					},
				}
			);

			// Auto-refresh fires.
			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );

			// Before resolution settles, user changes filter.
			rerender( {
				...defaultProps,
				query: { per_page: 20, page: 2 },
				isResolving: true,
				intervalSeconds: 10,
			} );
			expect( result.current.isAutoRefreshing ).toBe( false );
		} );

		it( 'is false for invalidateNow', () => {
			const { result, rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{ initialProps: defaultProps }
			);

			act( () => {
				result.current.invalidateNow();
			} );

			rerender( { ...defaultProps, isResolving: true } );
			expect( result.current.isAutoRefreshing ).toBe( false );
		} );
	} );

	describe( 'polling', () => {
		it( 'calls invalidateResolution after interval when focused', () => {
			renderHook( () =>
				useAutoRefresh( { ...defaultProps, intervalSeconds: 30 } )
			);

			expect( mockInvalidateResolution ).not.toHaveBeenCalled();

			act( () => {
				jest.advanceTimersByTime( 30_000 );
			} );

			expect( mockInvalidateResolution ).toHaveBeenCalledTimes( 1 );
			expect( mockInvalidateResolution ).toHaveBeenCalledWith(
				'getEntityRecords',
				[ 'root', 'order', { per_page: 20, page: 1 } ]
			);
		} );

		it( 'does NOT poll when window is unfocused', () => {
			jest.spyOn( document, 'hasFocus' ).mockReturnValue( false );

			renderHook( () => useAutoRefresh( defaultProps ) );

			act( () => {
				jest.advanceTimersByTime( 60_000 );
			} );

			expect( mockInvalidateResolution ).not.toHaveBeenCalled();
		} );

		it( 'stops polling when window loses focus', () => {
			renderHook( () => useAutoRefresh( defaultProps ) );

			act( () => {
				window.dispatchEvent( new Event( 'blur' ) );
			} );

			act( () => {
				jest.advanceTimersByTime( 60_000 );
			} );

			expect( mockInvalidateResolution ).not.toHaveBeenCalled();
		} );

		it( 'invalidates immediately on focus regain', () => {
			renderHook( () => useAutoRefresh( defaultProps ) );

			act( () => {
				window.dispatchEvent( new Event( 'blur' ) );
			} );
			act( () => {
				window.dispatchEvent( new Event( 'focus' ) );
			} );

			expect( mockInvalidateResolution ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'skips focus-regain refresh when already resolving', () => {
			const { rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{ initialProps: defaultProps }
			);

			// User triggers a filter change — starts resolving.
			rerender( { ...defaultProps, isResolving: true } );

			// User clicks away and back while resolving.
			act( () => {
				window.dispatchEvent( new Event( 'blur' ) );
			} );
			act( () => {
				window.dispatchEvent( new Event( 'focus' ) );
			} );

			// Should NOT have invalidated — resolution already in flight.
			expect( mockInvalidateResolution ).not.toHaveBeenCalled();
		} );

		it( 'skips interval poll when already resolving', () => {
			const { rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{
					initialProps: {
						...defaultProps,
						intervalSeconds: 10,
					},
				}
			);

			// User triggers a filter change — starts resolving.
			rerender( {
				...defaultProps,
				isResolving: true,
				intervalSeconds: 10,
			} );

			// Timer fires while resolving.
			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );

			// Should NOT have invalidated — resolution already in flight.
			expect( mockInvalidateResolution ).not.toHaveBeenCalled();
		} );

		it( 'resumes interval polling after focus regain', () => {
			renderHook( () =>
				useAutoRefresh( {
					...defaultProps,
					intervalSeconds: 30,
				} )
			);

			act( () => {
				window.dispatchEvent( new Event( 'blur' ) );
			} );
			act( () => {
				window.dispatchEvent( new Event( 'focus' ) );
			} );

			expect( mockInvalidateResolution ).toHaveBeenCalledTimes( 1 );

			act( () => {
				jest.advanceTimersByTime( 30_000 );
			} );

			expect( mockInvalidateResolution ).toHaveBeenCalledTimes( 2 );
		} );

		it( 'uses custom interval when provided', () => {
			renderHook( () =>
				useAutoRefresh( {
					...defaultProps,
					intervalSeconds: 10,
				} )
			);

			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );

			expect( mockInvalidateResolution ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'does NOT invalidate on initial mount (route loader already fetched)', () => {
			renderHook( () => useAutoRefresh( defaultProps ) );
			expect( mockInvalidateResolution ).not.toHaveBeenCalled();
		} );

		it( 'uses updated query on focus regain after query change while blurred', () => {
			const { rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{ initialProps: defaultProps }
			);

			act( () => {
				window.dispatchEvent( new Event( 'blur' ) );
			} );

			// Change query while blurred.
			const newQuery = { per_page: 20, page: 2 };
			rerender( { ...defaultProps, query: newQuery } );

			act( () => {
				window.dispatchEvent( new Event( 'focus' ) );
			} );

			expect( mockInvalidateResolution ).toHaveBeenCalledWith(
				'getEntityRecords',
				[ 'root', 'order', newQuery ]
			);
		} );

		it( 'resets timer when query changes', () => {
			const { rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{
					initialProps: {
						...defaultProps,
						intervalSeconds: 30,
					},
				}
			);

			// 20 seconds in, user changes filter.
			act( () => {
				jest.advanceTimersByTime( 20_000 );
			} );
			rerender( {
				...defaultProps,
				query: { per_page: 20, page: 2 },
				intervalSeconds: 30,
			} );
			mockInvalidateResolution.mockClear();

			// 20 more seconds — would have been 40s on old timer, but
			// timer reset so no poll yet.
			act( () => {
				jest.advanceTimersByTime( 20_000 );
			} );
			expect( mockInvalidateResolution ).not.toHaveBeenCalled();

			// 10 more seconds — 30s since query change, timer fires.
			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );
			expect( mockInvalidateResolution ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'clamps intervalSeconds below 10 to the 10-second minimum', () => {
			renderHook( () =>
				useAutoRefresh( {
					...defaultProps,
					intervalSeconds: 5,
				} )
			);

			act( () => {
				jest.advanceTimersByTime( 5_000 );
			} );
			expect( mockInvalidateResolution ).not.toHaveBeenCalled();

			act( () => {
				jest.advanceTimersByTime( 5_000 );
			} );
			expect( mockInvalidateResolution ).toHaveBeenCalledTimes( 1 );
		} );
	} );

	describe( 'invalidateNow', () => {
		it( 'calls invalidateResolution with the current query', () => {
			const { result } = renderHook( () =>
				useAutoRefresh( defaultProps )
			);

			act( () => {
				result.current.invalidateNow();
			} );

			expect( mockInvalidateResolution ).toHaveBeenCalledTimes( 1 );
			expect( mockInvalidateResolution ).toHaveBeenCalledWith(
				'getEntityRecords',
				[ 'root', 'order', { per_page: 20, page: 1 } ]
			);
		} );

		it( 'uses current query ref when called after query change', () => {
			const { result, rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{ initialProps: defaultProps }
			);

			rerender( {
				...defaultProps,
				query: { per_page: 20, page: 3 },
			} );

			act( () => {
				result.current.invalidateNow();
			} );

			expect( mockInvalidateResolution ).toHaveBeenCalledWith(
				'getEntityRecords',
				[ 'root', 'order', { per_page: 20, page: 3 } ]
			);
		} );
	} );

	describe( 'screen reader announcements', () => {
		const announceProps = {
			...defaultProps,
			intervalSeconds: 10,
			announceMessage: 'Orders list updated',
			records: [ { id: 1 }, { id: 2 } ] as unknown[],
		};

		it( 'announces when background refresh detects changed data', () => {
			const { rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{ initialProps: announceProps }
			);

			// SpacePress auto-refresh cycle — establishes fingerprint, no announce.
			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );
			rerender( { ...announceProps, isResolving: true } );
			rerender( { ...announceProps, isResolving: false } );
			expect( mockSpeak ).not.toHaveBeenCalled();

			// Second cycle — records changed, should announce.
			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );
			const changedRecords = [ { id: 1 }, { id: 3 } ];
			rerender( {
				...announceProps,
				isResolving: true,
				records: changedRecords,
			} );
			rerender( {
				...announceProps,
				isResolving: false,
				records: changedRecords,
			} );
			expect( mockSpeak ).toHaveBeenCalledWith(
				'Orders list updated',
				'polite'
			);
		} );

		it( 'does not announce when data is unchanged', () => {
			const { rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{ initialProps: announceProps }
			);

			// SpacePress cycle — establishes fingerprint.
			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );
			rerender( { ...announceProps, isResolving: true } );
			rerender( { ...announceProps, isResolving: false } );

			// Second cycle — same records.
			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );
			rerender( { ...announceProps, isResolving: true } );
			rerender( { ...announceProps, isResolving: false } );

			expect( mockSpeak ).not.toHaveBeenCalled();
		} );

		it( 'does not announce on error', () => {
			const { rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{ initialProps: announceProps }
			);

			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );
			rerender( {
				...announceProps,
				isResolving: true,
				error: true,
			} );
			rerender( {
				...announceProps,
				isResolving: false,
				error: true,
			} );

			expect( mockSpeak ).not.toHaveBeenCalled();
		} );

		it( 'does not announce without announceMessage', () => {
			const noAnnounceProps = {
				...defaultProps,
				intervalSeconds: 10,
				records: [ { id: 1 } ] as unknown[],
			};
			const { rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{ initialProps: noAnnounceProps }
			);

			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );
			rerender( {
				...noAnnounceProps,
				isResolving: true,
				records: [ { id: 2 } ],
			} );
			rerender( {
				...noAnnounceProps,
				isResolving: false,
				records: [ { id: 2 } ],
			} );

			expect( mockSpeak ).not.toHaveBeenCalled();
		} );

		it( 'uses recordIdKey for change detection', () => {
			const customKeyProps = {
				...defaultProps,
				intervalSeconds: 10,
				announceMessage: 'Disputes list updated',
				records: [
					{ dispute_id: 'dp_1' },
					{ dispute_id: 'dp_2' },
				] as unknown[],
				recordIdKey: 'dispute_id',
			};
			const { rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{ initialProps: customKeyProps }
			);

			// SpacePress cycle — establishes fingerprint.
			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );
			rerender( { ...customKeyProps, isResolving: true } );
			rerender( { ...customKeyProps, isResolving: false } );
			expect( mockSpeak ).not.toHaveBeenCalled();

			// Second cycle — dispute_id changed.
			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );
			const changedRecords = [
				{ dispute_id: 'dp_1' },
				{ dispute_id: 'dp_3' },
			];
			rerender( {
				...customKeyProps,
				isResolving: true,
				records: changedRecords,
			} );
			rerender( {
				...customKeyProps,
				isResolving: false,
				records: changedRecords,
			} );
			expect( mockSpeak ).toHaveBeenCalledWith(
				'Disputes list updated',
				'polite'
			);
		} );
	} );

	describe( 'consecutive-failure backoff', () => {
		let consoleSpy: jest.SpyInstance;

		beforeEach( () => {
			consoleSpy = jest
				.spyOn( console, 'error' )
				.mockImplementation( () => {} );
		} );

		const backoffProps = {
			...defaultProps,
			intervalSeconds: 10,
		};

		/**
		 * Simulate N consecutive background-refresh failures.
		 * Each cycle: trigger timer → resolving=true → resolving=false with error.
		 *
		 * @param rerender Hook rerender function.
		 * @param count    Number of failures to simulate.
		 */
		function simulateFailures(
			rerender: (
				props: typeof defaultProps & {
					error?: boolean;
					intervalSeconds?: number;
				}
			) => void,
			count: number
		) {
			for ( let i = 0; i < count; i++ ) {
				// Trigger auto-refresh via timer.
				act( () => {
					jest.advanceTimersByTime( 10_000 );
				} );
				act( () => {
					rerender( {
						...backoffProps,
						isResolving: true,
						error: true,
					} );
				} );
				act( () => {
					rerender( {
						...backoffProps,
						isResolving: false,
						error: true,
					} );
				} );
			}
		}

		it( 'stops polling after 5 consecutive failures', () => {
			const { rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{
					initialProps: backoffProps,
				}
			);

			simulateFailures( rerender, 5 );
			mockInvalidateResolution.mockClear();

			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );

			expect( mockInvalidateResolution ).not.toHaveBeenCalled();
		} );

		it( 'keeps polling when failures are below the threshold', () => {
			const { rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{
					initialProps: backoffProps,
				}
			);

			simulateFailures( rerender, 4 );
			mockInvalidateResolution.mockClear();

			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );

			expect( mockInvalidateResolution ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'resets failure counter on successful resolution', () => {
			const { rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{
					initialProps: backoffProps,
				}
			);

			simulateFailures( rerender, 4 );

			// Trigger one more auto-refresh that succeeds.
			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );
			act( () => {
				rerender( {
					...backoffProps,
					isResolving: true,
				} );
			} );
			act( () => {
				rerender( {
					...backoffProps,
					isResolving: false,
				} );
			} );
			mockInvalidateResolution.mockClear();

			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );

			expect( mockInvalidateResolution ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'resumes polling on focus regain after backoff', () => {
			const { rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{
					initialProps: backoffProps,
				}
			);

			simulateFailures( rerender, 5 );
			mockInvalidateResolution.mockClear();

			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );
			expect( mockInvalidateResolution ).not.toHaveBeenCalled();

			act( () => {
				window.dispatchEvent( new Event( 'blur' ) );
			} );
			act( () => {
				window.dispatchEvent( new Event( 'focus' ) );
			} );

			expect( mockInvalidateResolution ).toHaveBeenCalledTimes( 1 );

			// Interval continues after counter reset.
			act( () => {
				jest.advanceTimersByTime( 10_000 );
			} );
			expect( mockInvalidateResolution ).toHaveBeenCalledTimes( 2 );
		} );

		it( 'logs console.error on each background failure', () => {
			const { rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{
					initialProps: backoffProps,
				}
			);

			simulateFailures( rerender, 1 );

			expect( consoleSpy ).toHaveBeenCalledWith(
				'[useAutoRefresh] background refresh failed for root/order'
			);
		} );

		it( 'logs "polling paused" message on the 5th consecutive failure', () => {
			const { rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{
					initialProps: backoffProps,
				}
			);

			simulateFailures( rerender, 5 );

			expect( consoleSpy ).toHaveBeenLastCalledWith(
				'[useAutoRefresh] background refresh failed for root/order — polling paused (too many consecutive failures)'
			);
		} );

		it( 'invalidateNow bypasses the backoff guard', () => {
			const { result, rerender } = renderHook(
				( props ) => useAutoRefresh( props ),
				{
					initialProps: backoffProps,
				}
			);

			simulateFailures( rerender, 5 );
			mockInvalidateResolution.mockClear();

			act( () => {
				result.current.invalidateNow();
			} );

			expect( mockInvalidateResolution ).toHaveBeenCalledTimes( 1 );
		} );
	} );
} );
