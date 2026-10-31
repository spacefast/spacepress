/**
 * External dependencies
 */
import { useCallback, useEffect, useRef } from '@wordpress/element';
import { useDispatch } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { speak } from '@wordpress/a11y';
/**
 * Internal dependencies
 */
import useIsTabActive from './use-is-tab-active';

const DEFAULT_INTERVAL_SECONDS = 30;
const MAX_CONSECUTIVE_FAILURES = 5;

interface UseAutoRefreshOptions {
	/** Entity kind (e.g., 'root', 'woopayments'). */
	kind: string;
	/** Entity name (e.g., 'order', 'woopayments-dispute'). */
	name: string;
	/** Query parameters passed to getEntityRecords. */
	query: Record< string, unknown >;
	/** Whether core-data is currently resolving the entity records. */
	isResolving: boolean;
	/** The current entity records — used for change detection when announceMessage is set. */
	records?: unknown[] | null;
	/** Whether entity resolution encountered an error. */
	error?: boolean;
	/** Polling interval in seconds (minimum 10). Defaults to 30. */
	intervalSeconds?: number;
	/** Optional screen reader announcement when background refresh detects changed data. */
	announceMessage?: string;
	/**
	 * Property name to read from each record for change detection (e.g. 'dispute_id').
	 * Defaults to 'id'.
	 */
	recordIdKey?: string;
}

interface UseAutoRefreshReturn {
	/**
	 * Whether the current resolution was triggered by background polling or
	 * focus regain. Consumers use this to suppress loading UI during
	 * auto-refresh while still showing it for user-initiated actions:
	 *
	 * ```tsx
	 * isLoading={ (isResolving || !hasResolved) && !isAutoRefreshing }
	 * ```
	 */
	isAutoRefreshing: boolean;
	/**
	 * Imperatively invalidate the entity query cache right now.
	 * Does NOT set `isAutoRefreshing` — the resulting resolution will show
	 * loading UI, which is the correct behavior for user-initiated refreshes.
	 */
	invalidateNow: () => void;
}

/**
 * Auto-refresh entity records on a timer, gated by page activity.
 *
 * Periodically invalidates the core-data resolution cache for the given entity
 * query so that `useEntityRecords` / `useEntityRecordsWithPermissions` triggers
 * a refetch from the REST API. Only polls when the page is active (window
 * focused and tab visible).
 *
 * Returns `isAutoRefreshing` so consumers can suppress loading UI during
 * background refresh cycles while preserving it for user-initiated actions
 * (sort, filter, search, pagination).
 *
 * @param root0                 Hook options.
 * @param root0.kind            Entity kind (e.g., 'root', 'woopayments').
 * @param root0.name            Entity name (e.g., 'order', 'woopayments-dispute').
 * @param root0.query           Query parameters passed to getEntityRecords.
 * @param root0.isResolving     Whether core-data is currently resolving.
 * @param root0.records         The current entity records (for change detection with announceMessage).
 * @param root0.error           Whether entity resolution encountered an error.
 * @param root0.intervalSeconds Polling interval in seconds (minimum 10). Defaults to 30.
 * @param root0.announceMessage Optional screen reader announcement when background refresh detects changed data.
 * @param root0.recordIdKey     Property name for record ID (defaults to 'id').
 */
export default function useAutoRefresh( {
	kind,
	name,
	query,
	isResolving,
	records,
	error,
	intervalSeconds = DEFAULT_INTERVAL_SECONDS,
	announceMessage,
	recordIdKey = 'id',
}: UseAutoRefreshOptions ): UseAutoRefreshReturn {
	const isFocused = useIsTabActive();
	const dispatch = useDispatch( coreStore );

	// Use a ref for query so the invalidation callback doesn't change on every
	// render (query is a new object each time), which would restart the interval.
	const queryRef = useRef( query );
	queryRef.current = query;
	const recordsRef = useRef( records );
	recordsRef.current = records;
	const isResolvingRef = useRef( isResolving );
	isResolvingRef.current = isResolving;

	const wasBlurred = useRef( false );
	const prevFingerprintRef = useRef( '' );
	const consecutiveFailures = useRef( 0 );

	// Track whether the current resolution was triggered by background
	// auto-refresh. Set before invalidation, cleared when resolution settles
	// or when the query changes (user action).
	const isAutoRefreshingRef = useRef( false );

	// Serialize entity + query for change detection.
	const selectorKey = JSON.stringify( [ kind, name, query ] );
	const prevSelectorKey = useRef( selectorKey );

	// Clear auto-refresh flag when the query/entity changes (user action).
	if ( prevSelectorKey.current !== selectorKey ) {
		prevSelectorKey.current = selectorKey;
		isAutoRefreshingRef.current = false;
		prevFingerprintRef.current = '';
	}

	// Track consecutive background-refresh failures. After
	// MAX_CONSECUTIVE_FAILURES the polling interval becomes a no-op.
	// The counter resets on success or focus regain.
	// IMPORTANT: Must run before the clear effect below so it can read
	// isAutoRefreshingRef before it's reset.
	useEffect( () => {
		if ( isResolving || ! isAutoRefreshingRef.current ) {
			return;
		}
		if ( error ) {
			consecutiveFailures.current++;
			// eslint-disable-next-line no-console
			console.error(
				`[useAutoRefresh] background refresh failed for ${ kind }/${ name }` +
					( consecutiveFailures.current >= MAX_CONSECUTIVE_FAILURES
						? ' — polling paused (too many consecutive failures)'
						: '' )
			);
		} else {
			consecutiveFailures.current = 0;
		}
	}, [ isResolving, error, kind, name ] );

	// Clear the auto-refresh flag once the background resolution settles.
	// Announce to screen readers only when the data actually changed.
	useEffect( () => {
		if ( ! isResolving && isAutoRefreshingRef.current ) {
			isAutoRefreshingRef.current = false;

			const currentRecords = recordsRef.current;
			if (
				announceMessage &&
				! error &&
				Array.isArray( currentRecords )
			) {
				/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
				const fingerprint = JSON.stringify(
					currentRecords.map(
						( r ) =>
							( r as Record< string, unknown > )[ recordIdKey ]
					)
				);
				/* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
				if (
					prevFingerprintRef.current !== '' &&
					prevFingerprintRef.current !== fingerprint
				) {
					speak( announceMessage, 'polite' );
				}
				prevFingerprintRef.current = fingerprint;
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- recordsRef avoids re-runs from records reference changes
	}, [ isResolving, announceMessage, error, recordIdKey ] );

	// Stable invalidation callback — reads query from ref so it always
	// invalidates the current query without restarting the interval.
	const invalidate = useCallback( () => {
		/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-explicit-any */
		void ( dispatch as any ).invalidateResolution( 'getEntityRecords', [
			kind,
			name,
			queryRef.current,
		] );
		/* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-explicit-any */
	}, [ dispatch, kind, name ] );

	// Background-only invalidation — marks the upcoming resolution as
	// auto-refresh so consumers can suppress loading UI.
	const backgroundInvalidate = useCallback( () => {
		isAutoRefreshingRef.current = true;
		invalidate();
	}, [ invalidate ] );

	// Interval polling, gated by window focus. The selectorKey dependency
	// restarts the timer when the query/entity changes so we don't waste a
	// request shortly after the user already triggered a fresh fetch.
	useEffect( () => {
		if ( ! isFocused ) {
			wasBlurred.current = true;
			return;
		}

		// Refresh immediately when regaining focus (not on initial mount,
		// since the route loader already fetched fresh data). Skip if a
		// user-initiated resolution is already in flight to avoid overriding
		// its loading state.
		if ( wasBlurred.current ) {
			wasBlurred.current = false;
			consecutiveFailures.current = 0;
			if ( ! isResolvingRef.current ) {
				backgroundInvalidate();
			}
		}

		const safeIntervalMs = Math.max( intervalSeconds, 10 ) * 1000;
		const intervalId = setInterval( () => {
			if (
				consecutiveFailures.current < MAX_CONSECUTIVE_FAILURES &&
				! isResolvingRef.current
			) {
				backgroundInvalidate();
			}
		}, safeIntervalMs );
		return () => clearInterval( intervalId );
		// eslint-disable-next-line react-hooks/exhaustive-deps -- selectorKey resets the timer on query/entity change
	}, [ isFocused, backgroundInvalidate, intervalSeconds, selectorKey ] );

	return {
		isAutoRefreshing: isAutoRefreshingRef.current,
		invalidateNow: invalidate,
	};
}
