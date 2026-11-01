import type { Filter, View } from '@zero-admin/dataviews';
import { isList } from './fields';
import type { DescribedCollection, DescribedColumn } from './types';

/** A `where` tree as `/zero/v1/<c>` accepts it. */
export type Where = Record< string, unknown >;

/**
 * DataViews view state → the query string of `GET /zero/v1/<c>` for an `editor: false` collection:
 * `limit`/`offset` from the page, `orderBy` with a `-` prefix for descending, per-field filters as
 * `where` operators (membership on a list column is `has`), and free-text search as `like` over
 * the title column (noted in the UI as such). A filter Zero cannot express is dropped, and
 * `droppedFilters` names it so the screen can say so rather than show a wrong page.
 */
export function tableQuery( view: View, collection: Pick< DescribedCollection, 'title' | 'primaryKey' | 'columns' > ): Record< string, string > {
	return tableQueryWithDropped( view, collection ).query;
}

export function tableQueryWithDropped( view: View, collection: Pick< DescribedCollection, 'title' | 'primaryKey' | 'columns' > ): { query: Record< string, string >; droppedFilters: string[]; droppedSort: string | null } {
	const perPage = view.perPage ?? 20;
	const page = view.page ?? 1;
	const query: Record< string, string > = { limit: String( perPage ), offset: String( ( page - 1 ) * perPage ) };
	if ( view.sort?.field ) {
		query.orderBy = `${ view.sort.direction === 'desc' ? '-' : '' }${ view.sort.field }`;
	}
	const clauses: Where[] = [];
	const droppedFilters: string[] = [];
	for ( const filter of view.filters ?? [] ) {
		const clause = whereOf( filter.field, filter.operator, filter.value, collection.columns[ filter.field ] );
		if ( clause ) {
			clauses.push( clause );
		} else {
			droppedFilters.push( filter.field );
		}
	}
	if ( view.search && collection.title ) {
		clauses.push( { [ collection.title ]: { like: `%${ escapeLike( view.search ) }%` } } );
	}
	if ( clauses.length === 1 ) {
		query.where = JSON.stringify( clauses[ 0 ] );
	} else if ( clauses.length > 1 ) {
		query.where = JSON.stringify( { AND: clauses } );
	}
	return { query, droppedFilters, droppedSort: null };
}

function escapeLike( text: string ): string {
	return text.replace( /[%_\\]/g, ( c ) => `\\${ c }` );
}

/** One DataViews filter → one `where` clause; operators Zero does not have for this column return null. */
export function whereOf( field: string, operator: string, value: unknown, column?: DescribedColumn ): Where | null {
	const list = column ? isList( column ) : false;
	const options = Array.isArray( value ) ? value : null;
	if ( list ) {
		// A list column holds values: membership is `has`, one clause per chosen value.
		switch ( operator ) {
			case 'is':
			case 'isAny':
			case 'isAll': {
				const chosen = options ?? [ value ];
				const clauses = chosen.map( ( v ) => ( { [ field ]: { has: v } } ) );
				if ( clauses.length === 0 ) {
					return null;
				}
				if ( clauses.length === 1 ) {
					return clauses[ 0 ];
				}
				return operator === 'isAny' ? { OR: clauses } : { AND: clauses };
			}
			case 'isNot':
			case 'isNone':
			case 'isNotAll': {
				const chosen = options ?? [ value ];
				const clauses = chosen.map( ( v ) => ( { [ field ]: { has: v } } ) );
				if ( clauses.length === 0 ) {
					return null;
				}
				return { NOT: operator === 'isNotAll' ? { AND: clauses } : clauses.length === 1 ? clauses[ 0 ] : { OR: clauses } };
			}
			default:
				return null;
		}
	}
	switch ( operator ) {
		case 'is':
		case 'on':
			return { [ field ]: { eq: value } };
		case 'isNot':
		case 'notOn':
			return { [ field ]: { ne: value } };
		case 'isAny':
			return options ? { [ field ]: { in: options } } : null;
		case 'isNone':
			return options ? { [ field ]: { notIn: options } } : null;
		case 'lessThan':
		case 'before':
			return { [ field ]: { lt: value } };
		case 'greaterThan':
		case 'after':
			return { [ field ]: { gt: value } };
		case 'lessThanOrEqual':
		case 'beforeInc':
			return { [ field ]: { lte: value } };
		case 'greaterThanOrEqual':
		case 'afterInc':
			return { [ field ]: { gte: value } };
		case 'contains':
			return typeof value === 'string' ? { [ field ]: { like: `%${ escapeLike( value ) }%` } } : null;
		case 'notContains':
			return typeof value === 'string' ? { [ field ]: { notLike: `%${ escapeLike( value ) }%` } } : null;
		case 'startsWith':
			return typeof value === 'string' ? { [ field ]: { like: `${ escapeLike( value ) }%` } } : null;
		case 'between':
			return options && options.length === 2 ? { AND: [ { [ field ]: { gte: options[ 0 ] } }, { [ field ]: { lte: options[ 1 ] } } ] } : null;
		default:
			return null;
	}
}

const CORE_STATUSES = [ 'draft', 'future', 'pending', 'private', 'publish' ];
const TO_CORE_STATUS: Record< string, string[] > = { draft: [ 'draft', 'pending', 'private' ], published: [ 'publish' ], scheduled: [ 'future' ] };

/**
 * The same view → core `/wp/v2/zero_<table>` query for a post-backed collection. Core can page,
 * search, sort by its own columns, and narrow by status; a status filter in any operator becomes
 * the set of core statuses it allows. Every other field filter cannot be expressed to core, so it
 * is dropped and reported, never silently ignored.
 */
export function postQuery( view: View, collection: Pick< DescribedCollection, 'title' | 'slug' | 'content' | 'primaryKey' > ): Record< string, unknown > {
	return postQueryWithDropped( view, collection ).query;
}

export function postQueryWithDropped( view: View, collection: Pick< DescribedCollection, 'title' | 'slug' | 'content' | 'primaryKey' > ): { query: Record< string, unknown >; droppedFilters: string[]; droppedSort: string | null } {
	const query: Record< string, unknown > = {
		per_page: view.perPage ?? 20,
		page: view.page ?? 1,
		context: 'edit',
		status: CORE_STATUSES.join( ',' ),
	};
	if ( view.search ) {
		query.search = view.search;
	}
	let droppedSort: string | null = null;
	if ( view.sort?.field ) {
		const core = coreFieldOf( view.sort.field, collection );
		if ( view.sort.field === collection.primaryKey ) {
			query.orderby = 'id';
			query.order = view.sort.direction;
		} else if ( core === 'title' || core === 'slug' ) {
			query.orderby = core;
			query.order = view.sort.direction;
		} else if ( core === 'publishedAt' ) {
			query.orderby = 'date';
			query.order = view.sort.direction;
		} else {
			// Core cannot order by an SCF field; say so rather than show an order that is not applied.
			droppedSort = view.sort.field;
		}
	}
	const droppedFilters: string[] = [];
	for ( const filter of view.filters ?? [] ) {
		if ( filter.field !== 'status' ) {
			droppedFilters.push( filter.field );
			continue;
		}
		const statuses = statusesOf( filter );
		if ( statuses === null ) {
			droppedFilters.push( filter.field );
			continue;
		}
		query.status = statuses.join( ',' );
	}
	return { query, droppedFilters, droppedSort };
}

/** The core statuses a Zero status filter allows, or null when the operator has no meaning here. */
export function statusesOf( filter: Pick< Filter, 'operator' | 'value' > ): string[] | null {
	const chosen = ( Array.isArray( filter.value ) ? filter.value : [ filter.value ] ).filter( ( v ): v is string => typeof v === 'string' );
	const allowed = new Set( chosen.flatMap( ( v ) => TO_CORE_STATUS[ v ] ?? [] ) );
	switch ( filter.operator ) {
		case 'is':
		case 'isAny':
			return allowed.size > 0 ? CORE_STATUSES.filter( ( s ) => allowed.has( s ) ) : null;
		case 'isNot':
		case 'isNone':
			return CORE_STATUSES.filter( ( s ) => ! allowed.has( s ) );
		default:
			return null;
	}
}

/** Which core column a Zero column is stored in, or null for an SCF field. */
export function coreFieldOf( column: string, collection: Pick< DescribedCollection, 'title' | 'slug' | 'content' > ): 'title' | 'slug' | 'content' | 'status' | 'publishedAt' | null {
	if ( column === collection.title ) {
		return 'title';
	}
	if ( column === collection.slug ) {
		return 'slug';
	}
	if ( column === collection.content ) {
		return 'content';
	}
	if ( column === 'status' ) {
		return 'status';
	}
	if ( column === 'publishedAt' ) {
		return 'publishedAt';
	}
	return null;
}
