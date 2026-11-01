/**
 * External dependencies
 */
import { useEffect, useRef } from '@wordpress/element';
/**
 * Internal dependencies
 */
import useIsTabActive from './use-is-tab-active';

/**
 * Execute a callback on a recurring interval, but only while the tab is active.
 *
 * Calls `callback` immediately when the tab becomes active, then repeats every
 * `intervalInSeconds` seconds. Pauses automatically when the user switches to
 * another app or browser tab (via {@link useIsTabActive}). When the tab
 * regains activity the callback fires immediately and the interval restarts.
 *
 * The callback is stabilized via a ref — callers do **not** need to memoize it.
 * Changing the callback identity between renders will not restart the interval.
 *
 * A minimum interval of 1 second is enforced to prevent tight loops from
 * degenerate values (0 or negative). Higher-level hooks (e.g. `useAutoRefresh`)
 * may impose stricter minimums.
 *
 * @param callback          Function to execute on each tick.
 * @param intervalInSeconds Interval between ticks, in seconds (minimum 1).
 *
 * @example
 * ```tsx
 * // Poll for new order data every 30 s, pausing when the tab is inactive.
 * useTabActiveInterval( refreshOrders, 30 );
 * ```
 */
export default function useTabActiveInterval(
	callback: () => void,
	intervalInSeconds: number
): void {
	const isFocused = useIsTabActive();
	const callbackRef = useRef( callback );
	callbackRef.current = callback;

	useEffect( () => {
		if ( ! isFocused ) {
			return;
		}

		callbackRef.current();

		const intervalID = setInterval(
			() => callbackRef.current(),
			Math.max( intervalInSeconds, 1 ) * 1000
		);

		return () => clearInterval( intervalID );
	}, [ intervalInSeconds, isFocused ] );
}
