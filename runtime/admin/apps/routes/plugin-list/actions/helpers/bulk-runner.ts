import { dispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';

/**
 * Bulk runner utilities for plugin actions (sequential execution).
 *
 * What it does
 * - Execute an async worker over a list of items one-by-one (sequentially).
 * - Preserves input order in the results array.
 * - Returns a compact summary similar to Promise.allSettled.
 * - Optionally emits a success snackbar for multi-item operations.
 *
 * Example
 *   await bulkAction(items, doWork, {
 *     onProgress: (done, total) => setProgress(done / total),
 *     buildMessage: (ok, fail) => sprintf(__('Updated %d plugins.', 'first-admin'), ok),
 *   });
 */

export type BulkResult = {
	fulfilled: number;
	rejected: number;
	results: PromiseSettledResult< any >[];
};
/**
 * Runs an async worker over items sequentially and reports progress.
 *
 * @template T
 * @param {T[]}                                                    items                List of items to process sequentially.
 * @param {(item: T) => Promise<any>}                              worker               Async worker invoked once per item, in order.
 * @param {{ onProgress?: (done: number, total: number) => void }} [options]            Optional configuration.
 * @param {(done: number, total: number) => void}                  [options.onProgress] Callback invoked after each item with counts.
 * @return {Promise<BulkResult>} A compact summary of fulfilled/rejected counts plus per-item results.
 */
async function runBulk< T >(
	items: T[],
	worker: ( item: T ) => Promise< any >,
	options: { onProgress?: ( done: number, total: number ) => void } = {}
): Promise< BulkResult > {
	const total = items.length;
	if ( total === 0 ) {
		return { fulfilled: 0, rejected: 0, results: [] };
	}

	const results: PromiseSettledResult< any >[] = new Array( total );
	let done = 0;
	let fulfilled = 0;
	let rejected = 0;

	for ( let i = 0; i < total; i++ ) {
		try {
			const value = await worker( items[ i ] );
			results[ i ] = {
				status: 'fulfilled',
				value,
			} as PromiseFulfilledResult< any >;
			fulfilled++;
		} catch ( err: any ) {
			results[ i ] = {
				status: 'rejected',
				reason: err,
			} as PromiseRejectedResult;
			rejected++;
		} finally {
			done++;
			options.onProgress?.( done, total );
		}
	}

	return { fulfilled, rejected, results };
}

export type BulkActionOptions = {
	onProgress?: ( done: number, total: number ) => void;
	buildMessage?: ( fulfilled: number, rejected: number ) => string;
	noticeOptions?: Record< string, any >;
	showOnSingle?: boolean; // when true, also show notice for a single item
};
/**
 * A convenience wrapper around runBulk that optionally builds and dispatches a
 * success notice for multi-item operations. Callers provide buildMessage to
 * generate the localized message based on the outcome.
 *
 * @template T
 * @param {T[]}                                             items                   List of items to process sequentially.
 * @param {(item: T) => Promise<any>}                       worker                  Async worker invoked once per item, in order.
 * @param {BulkActionOptions}                               [options]               Optional configuration.
 * @param {(done: number, total: number) => void}           [options.onProgress]    Progress callback forwarded to runBulk.
 * @param {(fulfilled: number, rejected: number) => string} [options.buildMessage]  Builder for the success snackbar message.
 * @param {Record<string, any>}                             [options.noticeOptions] Additional notice options (e.g., id).
 * @param {boolean}                                         [options.showOnSingle]  When true, show notice even for a single item.
 * @return {Promise<BulkResult>} A compact summary of fulfilled/rejected counts plus per-item results.
 */
export async function bulkAction< T >(
	items: T[],
	worker: ( item: T ) => Promise< any >,
	options: BulkActionOptions = {}
): Promise< BulkResult > {
	const { onProgress, buildMessage, noticeOptions, showOnSingle } = options;
	const result = await runBulk( items, worker, { onProgress } );

	const multi = items.length > 1;
	const shouldShow = !! buildMessage && ( multi || showOnSingle );
	if ( shouldShow ) {
		try {
			const message = buildMessage( result.fulfilled, result.rejected );
			if ( message ) {
				// Fire-and-forget: notice creation shouldn't block the bulk flow.
				void dispatch( noticesStore ).createSuccessNotice( message, {
					type: 'snackbar',
					...( noticeOptions || {} ),
				} );
			}
		} catch {
			// Ignore notice failures to avoid interrupting action flow.
		}
	}
	return result;
}
