import { useCallback, useEffect, useMemo, useState } from '@wordpress/element';
import type { View } from '@zero-admin/dataviews';
import { cleanRow, clearProblem, unknownProblem, postOfRow, postQueryWithDropped, rowOfPost, scheduleProblem, tableQueryWithDropped, UTC, type CorePost, type DescribedCollection, type Row, type SiteTime } from '@zero-admin/schema';
import { core, coreList, zero, ZeroRequestError } from './api';
import { paginationOf } from './pagination';
import type { Problem } from './problem';

/**
 * The rows of a collection for a DataViews view, through the API that guards them: core
 * `/wp/v2/zero_<table>` for a post-backed collection (every row keyed by Zero's column names), or
 * `/zero/v1/<c>` for an `editor: false` table. Nothing is cached across viewers or views.
 */
export function useRows( collection: DescribedCollection | null, view: View, site: SiteTime = UTC ) {
	const [ state, setState ] = useState< { rows: Row[]; totalItems: number; totalPages: number; droppedFilters: string[]; droppedSort: string | null; isLoading: boolean; problem: Problem | null; generation: number } >( {
		rows: [], totalItems: 0, totalPages: 1, droppedFilters: [], droppedSort: null, isLoading: true, problem: null, generation: 0,
	} );
	const [ reloads, setReloads ] = useState( 0 );
	const reload = useCallback( () => setReloads( ( n ) => n + 1 ), [] );
	const key = JSON.stringify( [ collection?.name, view.page, view.perPage, view.sort, view.filters, view.search ] );

	useEffect( () => {
		if ( ! collection ) {
			return;
		}
		let cancelled = false;
		setState( ( s ) => ( { ...s, isLoading: true } ) );
		listRows( collection, view, site )
			.then( ( result ) => {
				if ( ! cancelled ) {
					setState( ( s ) => ( { ...result, isLoading: false, problem: null, generation: s.generation + 1 } ) );
				}
			} )
			.catch( ( error: unknown ) => {
				if ( ! cancelled ) {
					setState( ( s ) => ( { ...s, rows: [], isLoading: false, problem: error instanceof ZeroRequestError ? error.problem : { status: 0, code: 'error', message: String( error ), field: null } } ) );
				}
			} );
		return () => {
			cancelled = true;
		};
		// The view key captures every input that changes the request.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ key, reloads ] );

	return useMemo( () => ( { ...state, reload } ), [ state, reload ] );
}

export async function listRows( collection: DescribedCollection, view: View, site: SiteTime = UTC ): Promise< { rows: Row[]; totalItems: number; totalPages: number; droppedFilters: string[]; droppedSort: string | null } > {
	if ( collection.wp ) {
		const { query, droppedFilters, droppedSort } = postQueryWithDropped( view, collection );
		const { items, totalItems, totalPages } = await coreList< CorePost >( `/${ collection.wp.postType }`, query );
		return { rows: items.map( ( post ) => rowOfPost( post, collection, site ) ), totalItems, totalPages, droppedFilters, droppedSort };
	}
	const { query, droppedFilters, droppedSort } = tableQueryWithDropped( view, collection );
	const rows = await zero< Row[] >( 'GET', `/${ collection.name }`, { query } );
	const page = view.page ?? 1;
	const perPage = view.perPage ?? 20;
	return { rows, ...paginationOf( page, perPage, rows.length ), droppedFilters, droppedSort };
}

/** One row by its key, through the guarded API, keyed by Zero's column names. */
export async function getRow( collection: DescribedCollection, id: string | number, site: SiteTime = UTC ): Promise< Row > {
	if ( collection.wp ) {
		const post = await core< CorePost >( 'GET', `/${ collection.wp.postType }/${ encodeURIComponent( String( id ) ) }`, { query: { context: 'edit' } } );
		return rowOfPost( post, collection, site );
	}
	return zero< Row >( 'GET', `/${ collection.name }/${ encodeURIComponent( String( id ) ) }` );
}

/** Create a row the way the screen does: core for post-backed collections, `/zero/v1` for tables. */
export async function createRow( collection: DescribedCollection, values: Row, site: SiteTime = UTC ): Promise< Row > {
	values = forCreate( values );
	if ( collection.wp ) {
		refuseBadSchedule( values );
		refuseUnclearable( values, collection, {} );
		const body = postOfRow( values, collection, site );
		if ( ! ( 'status' in body ) ) {
			body.status = collection.drafts ? 'draft' : 'publish';
		}
		const post = await core< CorePost >( 'POST', `/${ collection.wp.postType }`, { body } );
		return rowOfPost( post, collection, site );
	}
	return zero< Row >( 'POST', `/${ collection.name }`, { body: values } );
}

/** Patch a row with only what changed. */
export async function updateRow(
	collection: DescribedCollection,
	id: string | number,
	edits: Row,
	options: { site?: SiteTime; full?: Row; original?: Row } = {}
): Promise< Row > {
	const site = options.site ?? UTC;
	edits = cleanRow( edits );
	if ( collection.wp ) {
		refuseBadSchedule( { ...( options.full ?? {} ), ...edits } );
		refuseUnclearable( edits, collection, options.original ?? {} );
		const post = await core< CorePost >( 'POST', `/${ collection.wp.postType }/${ encodeURIComponent( String( id ) ) }`, { body: postOfRow( edits, collection, site ) } );
		return rowOfPost( post, collection, site );
	}
	return zero< Row >( 'PATCH', `/${ collection.name }/${ encodeURIComponent( String( id ) ) }`, { body: edits } );
}

/** Delete a row. Post-backed rows go to the trash the way the editor's delete does; tables delete outright. */
export async function deleteRow( collection: DescribedCollection, id: string | number ): Promise< void > {
	if ( collection.wp ) {
		await core( 'DELETE', `/${ collection.wp.postType }/${ encodeURIComponent( String( id ) ) }` );
		return;
	}
	await zero( 'DELETE', `/${ collection.name }/${ encodeURIComponent( String( id ) ) }` );
}

/** A `scheduled` status without a future date would publish now; refuse it here with a pointer at the date. */
function refuseBadSchedule( values: Row ): void {
	const problem = scheduleProblem( values );
	if ( problem ) {
		throw new ZeroRequestError( { status: 422, code: 'invalid_input', message: problem, field: 'publishedAt' } );
	}
}

/**
 * Before a core save: a member the schema does not know is refused at its pointer (as Zero would),
 * and a nested number, boolean or id cannot be cleared through core's SCF field, so that is refused
 * too rather than keep the old value silently. Tables and globals go to Zero, which checks itself.
 */
function refuseUnclearable( edits: Row, collection: DescribedCollection, original: Row ): void {
	const unknown = unknownProblem( edits, collection );
	if ( unknown ) {
		throw new ZeroRequestError( { status: 422, code: 'invalid_input', message: 'This is not a field of the collection.', field: unknown.replace( /^\//, '' ) } );
	}
	const pointer = clearProblem( edits, collection, original );
	if ( pointer ) {
		throw new ZeroRequestError( { status: 422, code: 'invalid_input', message: 'This nested value cannot be cleared here; set it to a value, or clear it in the classic editor.', field: pointer.replace( /^\//, '' ) } );
	}
}

/** The keys of `edits` whose value differs from `original`, as the patch to send. */
export function changedOnly( original: Row, edits: Row ): Row {
	const out: Row = {};
	for ( const [ key, raw ] of Object.entries( cleanRow( edits ) ) ) {
		// A control that was cleared hands back undefined; JSON would drop it and the save would keep
		// the old value while reporting success. An explicit clear is null.
		const value = raw === undefined ? null : raw;
		if ( JSON.stringify( original[ key ] ?? null ) !== JSON.stringify( value ) ) {
			out[ key ] = value;
		}
	}
	return out;
}

/** Values a create sends: every key the form holds, with cleared controls as null. */
export function forCreate( values: Row ): Row {
	const out: Row = {};
	for ( const [ key, raw ] of Object.entries( cleanRow( values ) ) ) {
		out[ key ] = raw === undefined ? null : raw;
	}
	return out;
}
