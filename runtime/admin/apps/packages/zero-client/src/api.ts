import apiFetch from '@wordpress/api-fetch';
import { addQueryArgs } from '@wordpress/url';
import { problemOf, type Problem } from './problem';

export class ZeroRequestError extends Error {
	readonly problem: Problem;
	constructor( problem: Problem ) {
		super( problem.message );
		this.problem = problem;
	}
}

/**
 * One request to `/zero/v1<path>`, unwrapped from its `{ data }` envelope. `wp.apiFetch` carries the
 * REST nonce; a non-2xx answer throws a `ZeroRequestError` carrying the problem document.
 */
export async function zero< T = unknown >( method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, options: { query?: Record< string, string >; body?: unknown; form?: FormData } = {} ): Promise< T > {
	const target = options.query ? addQueryArgs( `/zero/v1${ path }`, options.query ) : `/zero/v1${ path }`;
	try {
		const response = ( await apiFetch( {
			path: target,
			method,
			...( options.form ? { body: options.form } : options.body !== undefined ? { data: options.body } : {} ),
		} ) ) as { data: T };
		return response.data;
	} catch ( error ) {
		throw new ZeroRequestError( problemOf( error ) );
	}
}

/** The same for core `/wp/v2` paths the screens call directly (saves the editor would make). */
export async function core< T = unknown >( method: 'GET' | 'POST' | 'DELETE', path: string, options: { query?: Record< string, unknown >; body?: unknown } = {} ): Promise< T > {
	const target = options.query ? addQueryArgs( `/wp/v2${ path }`, options.query ) : `/wp/v2${ path }`;
	try {
		return ( await apiFetch( { path: target, method, ...( options.body !== undefined ? { data: options.body } : {} ) } ) ) as T;
	} catch ( error ) {
		throw new ZeroRequestError( problemOf( error ) );
	}
}

/** A core list with its totals, read from the response headers. */
export async function coreList< T = unknown >( path: string, query: Record< string, unknown > ): Promise< { items: T[]; totalItems: number; totalPages: number } > {
	try {
		const response = ( await apiFetch( { path: addQueryArgs( `/wp/v2${ path }`, query ), parse: false } ) ) as Response;
		const items = ( await response.json() ) as T[];
		return {
			items,
			totalItems: Number( response.headers.get( 'X-WP-Total' ) ?? items.length ),
			totalPages: Number( response.headers.get( 'X-WP-TotalPages' ) ?? 1 ),
		};
	} catch ( error ) {
		if ( error instanceof Response ) {
			let body: unknown = {};
			try {
				body = await error.json();
			} catch {}
			throw new ZeroRequestError( problemOf( { ...( body as object ), status: error.status } ) );
		}
		throw new ZeroRequestError( problemOf( error ) );
	}
}
