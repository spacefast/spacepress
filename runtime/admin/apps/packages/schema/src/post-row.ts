import type { Row } from './fields';
import { coreFieldOf } from './query';
import { fromScf, toScf, unclearable, unknownMember, UTC, type SiteTime } from './scf';
import type { DescribedCollection } from './types';

/** A post as core `/wp/v2/zero_<table>` returns it in the edit context, as far as the admin reads it. */
export interface CorePost {
	id: number;
	status?: string;
	slug?: string;
	date_gmt?: string;
	title?: string | { raw?: string; rendered?: string };
	content?: string | { raw?: string; rendered?: string };
	acf?: Record< string, unknown > | unknown[];
	[ key: string ]: unknown;
}

const TO_ZERO_STATUS: Record< string, string > = { publish: 'published', future: 'scheduled', draft: 'draft', pending: 'draft', private: 'draft', 'auto-draft': 'draft' };
const TO_CORE_STATUS: Record< string, string > = { published: 'publish', scheduled: 'future', draft: 'draft' };

function rawOf( value: unknown ): unknown {
	if ( value && typeof value === 'object' && ( 'raw' in value || 'rendered' in value ) ) {
		const v = value as { raw?: unknown; rendered?: unknown };
		return v.raw ?? v.rendered ?? '';
	}
	return value;
}

/**
 * A core post → the row the admin shows, keyed by Zero's column names: the title, slug and content
 * columns from core's own fields, `status` and `publishedAt` from core's, and every SCF field from
 * `acf` with the `zero_` prefix dropped. A column absent from the response stays absent (the viewer
 * may not read it), which is what the form renders by.
 */
export function rowOfPost( post: CorePost, collection: DescribedCollection, site: SiteTime = UTC ): Row {
	const row: Row = { [ collection.primaryKey ]: post.id };
	if ( collection.title && post.title !== undefined ) {
		row[ collection.title ] = rawOf( post.title );
	}
	if ( collection.slug && post.slug !== undefined ) {
		row[ collection.slug ] = post.slug;
	}
	if ( collection.content && post.content !== undefined ) {
		row[ collection.content ] = rawOf( post.content );
	}
	if ( 'status' in collection.columns && typeof post.status === 'string' ) {
		row.status = TO_ZERO_STATUS[ post.status ] ?? post.status;
	}
	if ( 'publishedAt' in collection.columns && typeof post.date_gmt === 'string' ) {
		row.publishedAt = post.status === 'publish' || post.status === 'future' ? `${ post.date_gmt }Z` : null;
	}
	const prefix = collection.wp?.metaPrefix ?? 'zero_';
	const acf = post.acf && ! Array.isArray( post.acf ) ? post.acf : {};
	for ( const [ key, value ] of Object.entries( acf ) ) {
		if ( key.startsWith( prefix ) ) {
			const column = key.slice( prefix.length );
			if ( Object.prototype.hasOwnProperty.call( collection.columns, column ) ) {
				row[ column ] = fromScf( collection.columns[ column ], value, site );
			}
		}
	}
	return row;
}

/**
 * Edits to a row → the body of a core save: core's own fields by their core name, everything else
 * under `acf` by its SCF name. The key is never sent. A `scheduled` status travels with its date
 * (`date_gmt` from `publishedAt`), since core publishes at once when the date is not in the future;
 * without a date the save asks for one rather than publishing by accident.
 */
export function postOfRow( edits: Row, collection: DescribedCollection, site: SiteTime = UTC ): Record< string, unknown > {
	const body: Record< string, unknown > = {};
	const acf: Record< string, unknown > = {};
	const prefix = collection.wp?.metaPrefix ?? 'zero_';
	for ( const [ column, value ] of Object.entries( edits ) ) {
		if ( column === collection.primaryKey ) {
			continue;
		}
		const core = coreFieldOf( column, collection );
		if ( core === 'status' ) {
			body.status = typeof value === 'string' ? TO_CORE_STATUS[ value ] ?? value : value;
		} else if ( core === 'publishedAt' ) {
			if ( typeof value === 'string' && value !== '' ) {
				body.date_gmt = value.replace( /\.\d{3}Z$/, '' ).replace( /Z$/, '' );
			}
		} else if ( core ) {
			body[ core ] = value;
		} else if ( Object.prototype.hasOwnProperty.call( collection.columns, column ) ) {
			acf[ `${ prefix }${ column }` ] = toScf( collection.columns[ column ], value, site, `${ collection.wp?.fieldKeyPrefix ?? '' }${ column }` );
		}
	}
	if ( Object.keys( acf ).length > 0 ) {
		body.acf = acf;
	}
	return body;
}

/**
 * Core publishes a `future` post at once when its date is under a minute away (`wp_insert_post`
 * compares against `time() + 59`); the request also takes time to arrive. A schedule is accepted
 * only when the date is at least two minutes ahead of the browser's clock.
 */
export const SCHEDULE_MARGIN_MS = 120_000;

/** The pointer of the first member a structured value holds that its schema does not (see `unknownMember`), or null. */
export function unknownProblem( edits: Row, collection: Pick< DescribedCollection, 'columns' > ): string | null {
	for ( const [ column, value ] of Object.entries( edits ) ) {
		const def = collection.columns[ column ];
		const found = def ? unknownMember( def, value, `/${ column }` ) : null;
		if ( found ) {
			return found;
		}
	}
	return null;
}

/** The pointer of a nested clear core cannot apply in this save (see `unclearable`), judged against the row as loaded, or null. */
export function clearProblem( edits: Row, collection: DescribedCollection, original: Row = {} ): string | null {
	for ( const [ column, value ] of Object.entries( edits ) ) {
		const def = collection.columns[ column ];
		const found = def ? unclearable( def, value, `/${ column }`, original[ column ] ) : null;
		if ( found ) {
			return found;
		}
	}
	return null;
}

/** Why a save cannot go: a `scheduled` status needs a `publishedAt` safely in the future, or core publishes now. */
export function scheduleProblem( values: Row, now: Date = new Date() ): string | null {
	if ( values.status !== 'scheduled' ) {
		return null;
	}
	const at = typeof values.publishedAt === 'string' ? new Date( values.publishedAt ) : null;
	if ( ! at || Number.isNaN( at.getTime() ) ) {
		return 'Scheduling needs a publish date.';
	}
	return at.getTime() >= now.getTime() + SCHEDULE_MARGIN_MS ? null : 'The publish date must be at least two minutes ahead to schedule.';
}
