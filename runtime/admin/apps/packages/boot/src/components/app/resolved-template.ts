/**
 * Server-side template resolution: fetches all entities needed for a template
 * in a single REST call and injects them into core-data.
 */

// The exception is ok because this module pre-seeds core-data with entities
// from a bundled endpoint — it is not general-purpose data fetching.
// eslint-disable-next-line no-restricted-imports
import apiFetch from '@wordpress/api-fetch';
import { dispatch } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { addQueryArgs } from '@wordpress/url';

interface RecordQuery {
	id: string | number;
	query: Record< string, unknown >;
}

interface EntityGroup {
	kind: string;
	name: string;
	records: Array< Record< string, unknown > >;
	queries: Array< Record< string, unknown > >;
	record_queries: RecordQuery[];
}

interface ResolvedTemplateResponse {
	template_id: string | null;
	entities: EntityGroup[];
}

// Request cache: deduplicates concurrent calls and caches successful results
// so re-renders don't trigger duplicate fetches. Failed requests are evicted
// so the next call retries.
const cache = new Map< string, Promise< ResolvedTemplateResponse > >();

/**
 * Fetches the resolved template bundle from the server.
 *
 * Front-page resolutions (no postId) are cached for the lifetime of the page;
 * concurrent calls share a single request. Post-specific resolutions are never
 * cached — each call issues a fresh request so stale post entity data (e.g.
 * auto-draft status after a save) is never replayed into core-data.
 *
 * @param postType Optional post type for PostCanvas resolution.
 * @param postId   Optional post ID for PostCanvas resolution.
 * @return The resolved template response.
 */
export async function fetchResolvedTemplate(
	postType?: string,
	postId?: string
): Promise< ResolvedTemplateResponse > {
	const cacheKey = `${ postType ?? '' }:${ postId ?? '' }`;

	const existing = cache.get( cacheKey );
	if ( existing ) {
		return existing;
	}

	const queryArgs: Record< string, string | number > = {};
	if ( postType ) {
		queryArgs.post_type = postType;
	}
	if ( postId ) {
		queryArgs.post_id = postId;
	}

	const promise = apiFetch< ResolvedTemplateResponse >( {
		path: addQueryArgs( '/wp/v2/resolved-template', queryArgs ),
	} ).catch( ( error: unknown ) => {
		if ( ! postId ) {
			cache.delete( cacheKey );
		}
		throw error;
	} );

	// Only cache front-page canvas resolutions. Post-specific responses
	// include the post entity itself, which can become stale after a save
	// (e.g. auto-draft → draft transition). Skipping the cache here ensures
	// the next canvas load for the same post fetches fresh data.
	if ( ! postId ) {
		cache.set( cacheKey, promise );
	}

	return promise;
}

/**
 * Injects resolved template entities into core-data stores, marking
 * resolutions as complete so resolvers don't re-fetch.
 *
 * @param response The resolved template response from the server.
 */
export async function injectResolvedTemplate(
	response: ResolvedTemplateResponse
): Promise< void > {
	const coreDispatch = dispatch( coreStore );

	for ( const group of response.entities ) {
		const {
			kind,
			name,
			records,
			queries,
			record_queries: recordQueries,
		} = group;

		// Inject records into core-data for each query that was satisfied.
		if ( records.length > 0 ) {
			if ( queries.length > 0 ) {
				for ( const query of queries ) {
					await coreDispatch.receiveEntityRecords(
						kind,
						name,
						records,
						query
					);
				}
			} else {
				// Records without queries are singular entity fetches.
				await coreDispatch.receiveEntityRecords( kind, name, records );
			}
		}

		// Mark plural query resolutions as finished (even if first records —
		// prevents resolvers from re-fetching an empty result set).
		for ( const query of queries ) {
			if ( records.length === 0 ) {
				// For empty results, inject an empty array to seed the cache.
				await coreDispatch.receiveEntityRecords(
					kind,
					name,
					[],
					query
				);
			}
			await dispatch( coreStore ).finishResolution( 'getEntityRecords', [
				kind,
				name,
				query,
			] );
		}

		// Mark singular record resolutions as finished.
		// Also finish with query params (e.g. { context: 'edit' }) so
		// downstream getEntityRecord calls with those params don't re-fetch.
		const recordQueryMap = new Map(
			( recordQueries ?? [] ).map( ( rq ) => [ rq.id, rq.query ] )
		);
		for ( const record of records ) {
			if ( ! ( 'id' in record ) ) {
				continue;
			}
			const id = record.id;
			if ( typeof id === 'string' || typeof id === 'number' ) {
				// Only finish getEntityRecord(kind, name, id) resolution for
				// records injected without queries (singular entity fetches).
				// receiveEntityRecords with a query does not guarantee the record
				// is accessible via getEntityRecord without a query argument —
				// finishing that resolution prevents the resolver from ever
				// fetching the record into the default cache. This breaks
				// selectors like getTemplateId that rely on
				// getEditedEntityRecord, which reads from the default cache.
				if ( queries.length === 0 ) {
					await dispatch( coreStore ).finishResolution(
						'getEntityRecord',
						[ kind, name, id ]
					);
				}
				const rq = recordQueryMap.get( id );
				if ( rq ) {
					await dispatch( coreStore ).finishResolution(
						'getEntityRecord',
						[ kind, name, id, rq ]
					);
				}
			}
		}
	}
}
