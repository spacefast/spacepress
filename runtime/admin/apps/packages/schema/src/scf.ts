import type { DescribedColumn } from './types';

/**
 * Zero's decoded values ↔ the form SCF carries them in on core `/wp/v2/zero_<table>` (`acf`), as
 * the runtime's own codec defines it (`Scf::scfValue` / `Scf::fromScf`):
 *
 * - `date` is `YYYYMMDD`, `timestamp` is `YYYY-MM-DD HH:MM:SS` (UTC), `boolean` is 1/0;
 * - `json` is its JSON text (SCF keeps it in a textarea);
 * - `media`/`file` are ids, `mediaList` a list of ids;
 * - `group`, `repeater` and `blocks` nest with their sub-fields; a block row carries its layout
 *   as `acf_fc_layout`. Sub-field keys come back as the bare name, the meta name or the field key;
 *   the runtime accepts all three on input, so the admin sends bare names.
 */
/**
 * The site's UTC offset in minutes at the moment it applies. SCF's picker speaks site time: the
 * runtime converts on the way in (`get_gmt_from_date`) and out (`get_date_from_gmt`), so core's
 * `acf` carries site-local timestamps while Zero's own API carries UTC. The page hands the admin
 * the site's timezone; the offset is computed per instant so DST is honoured.
 */
export interface SiteTime {
	/** An IANA zone (`Europe/Berlin`) or null when the site only has a fixed offset. */
	timezone: string | null;
	/** The fixed offset in hours (`2`, `-5.5`) when no zone is set. */
	gmtOffset: number;
}

export const UTC: SiteTime = { timezone: 'UTC', gmtOffset: 0 };

function offsetMinutes( site: SiteTime, at: Date ): number {
	if ( ! site.timezone ) {
		return Math.round( site.gmtOffset * 60 );
	}
	try {
		const parts = new Intl.DateTimeFormat( 'en-US', { timeZone: site.timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' } ).formatToParts( at );
		const get = ( type: string ) => Number( parts.find( ( p ) => p.type === type )?.value ?? 0 );
		const asUtc = Date.UTC( get( 'year' ), get( 'month' ) - 1, get( 'day' ), get( 'hour' ), get( 'minute' ), get( 'second' ) );
		return Math.round( ( asUtc - at.getTime() ) / 60000 );
	} catch {
		return Math.round( site.gmtOffset * 60 );
	}
}

function pad( n: number ): string {
	return String( n ).padStart( 2, '0' );
}

/** A UTC instant → `Y-m-d H:i:s` in site time. */
export function toSiteTime( iso: string, site: SiteTime ): string {
	const at = new Date( iso );
	if ( Number.isNaN( at.getTime() ) ) {
		return iso;
	}
	const local = new Date( at.getTime() + offsetMinutes( site, at ) * 60000 );
	return `${ local.getUTCFullYear() }-${ pad( local.getUTCMonth() + 1 ) }-${ pad( local.getUTCDate() ) } ${ pad( local.getUTCHours() ) }:${ pad( local.getUTCMinutes() ) }:${ pad( local.getUTCSeconds() ) }`;
}

/** `Y-m-d H:i:s` in site time → the UTC instant. */
export function fromSiteTime( local: string, site: SiteTime ): string {
	const m = local.match( /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/ );
	if ( ! m ) {
		return local;
	}
	const naive = Date.UTC( Number( m[ 1 ] ), Number( m[ 2 ] ) - 1, Number( m[ 3 ] ), Number( m[ 4 ] ), Number( m[ 5 ] ), Number( m[ 6 ] ) );
	// The offset at the wall-clock instant; one more pass settles a DST edge.
	let utc = naive - offsetMinutes( site, new Date( naive ) ) * 60000;
	utc = naive - offsetMinutes( site, new Date( utc ) ) * 60000;
	return new Date( utc ).toISOString();
}

/**
 * `fieldKey` is the SCF field key of this column (`field_zero_posts_seo` for a top-level column, the
 * parent's key plus `_<name>` below it, plus `_<layout>` for a block member). Nested members are
 * sent by key: SCF's group and block updaters look a sub-field up by key first, and a key can never
 * collide with `acf_fc_layout` or an inherited object name the way a bare name could.
 */
export function toScf( column: DescribedColumn, value: unknown, site: SiteTime = UTC, fieldKey = '' ): unknown {
	if ( value === null || value === undefined ) {
		return null;
	}
	switch ( column.type ) {
		case 'boolean':
			return value ? 1 : 0;
		case 'date':
			return typeof value === 'string' ? value.replace( /-/g, '' ) : value;
		case 'timestamp':
			return typeof value === 'string' ? toSiteTime( value, site ) : value;
		case 'json':
			return JSON.stringify( value );
		case 'mediaList':
			return Array.isArray( value ) ? value.map( Number ) : value;
		case 'group':
			return isRecord( value ) ? fieldsToScf( column.fields ?? {}, value, site, fieldKey ) : value;
		case 'repeater':
			return Array.isArray( value ) ? value.map( ( row ) => ( isRecord( row ) ? fieldsToScf( column.fields ?? {}, row, site, fieldKey ) : row ) ) : value;
		case 'blocks':
			return Array.isArray( value )
				? value.map( ( row ) => {
						if ( ! isRecord( row ) || typeof row.layout !== 'string' || ! column.layouts || ! has( column.layouts, row.layout ) ) {
							return row;
						}
						const members = fieldsToScf( column.layouts[ row.layout ], row, site, fieldKey ? `${ fieldKey }_${ row.layout }` : '' );
						// The discriminator last, so a member that happens to be named like it never wins.
						return { ...members, acf_fc_layout: row.layout };
				  } )
				: value;
		default:
			return value;
	}
}

export function fromScf( column: DescribedColumn, value: unknown, site: SiteTime = UTC ): unknown {
	// SCF reports an empty image, file or relationship as `false`; only a boolean means it.
	if ( value === null || value === undefined || value === '' || ( value === false && column.type !== 'boolean' ) ) {
		return ( column.type === 'select' && column.multiple ) || column.type === 'mediaList' ? ( column.notNull ? [] : null ) : null;
	}
	switch ( column.type ) {
		case 'boolean':
			return value === true || value === 1 || value === '1';
		case 'integer':
		case 'media':
		case 'file':
			return typeof value === 'string' && value.trim() !== '' && Number.isFinite( Number( value ) ) ? Number( value ) : value;
		case 'real':
			return typeof value === 'string' && Number.isFinite( Number( value ) ) ? Number( value ) : value;
		case 'date': {
			const m = typeof value === 'string' ? value.match( /^(\d{4})(\d{2})(\d{2})$/ ) : null;
			return m ? `${ m[ 1 ] }-${ m[ 2 ] }-${ m[ 3 ] }` : value;
		}
		case 'timestamp':
			return typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test( value ) ? fromSiteTime( value, site ) : value;
		case 'json':
			if ( typeof value !== 'string' ) {
				return value;
			}
			try {
				return JSON.parse( value );
			} catch {
				return value;
			}
		case 'mediaList':
			return Array.isArray( value ) ? value.map( ( v ) => ( isRecord( v ) && 'ID' in v ? Number( v.ID ) : Number( v ) ) ) : value;
		case 'select':
			return column.multiple ? ( Array.isArray( value ) ? value.map( String ) : [ String( value ) ] ) : value;
		case 'group':
			return isRecord( value ) ? fieldsFromScf( column.fields ?? {}, value, site ) : value;
		case 'repeater':
			return Array.isArray( value ) ? value.map( ( row ) => ( isRecord( row ) ? fieldsFromScf( column.fields ?? {}, row, site ) : row ) ) : value;
		case 'blocks':
			return Array.isArray( value )
				? value.map( ( row ) => {
						if ( ! isRecord( row ) ) {
							return row;
						}
						const layout = String( row.acf_fc_layout ?? row.layout ?? '' );
						return { layout, ...fieldsFromScf( column.layouts?.[ layout ] ?? {}, row, site ) };
				  } )
				: value;
		default:
			return value;
	}
}

/** Kinds whose SCF REST schema takes any string, so a cleared value can travel as ''. (Email and URL carry a format that '' fails.) */
const STRING_LIKE = new Set( [ 'text', 'slug', 'richText', 'date', 'timestamp', 'json' ] );

/**
 * What a cleared sub-field is sent as. SCF's group updater skips a null sub-field (it tests
 * `isset`), so null would silently keep the old value; the REST schema of a number, boolean, id,
 * email or URL refuses ''. A string-like kind clears as '' (the runtime reads '' as null), a list
 * as []; the others cannot be cleared through core at all: `fieldsToScf` leaves them out (SCF
 * keeps what is stored, which is right when nothing was stored) and `unclearable` refuses the
 * save beforehand when something was.
 */
function clearedScf( column: DescribedColumn ): unknown {
	if ( STRING_LIKE.has( column.type ) || ( column.type === 'select' && ! column.multiple ) ) {
		return '';
	}
	if ( column.type === 'mediaList' || column.type === 'repeater' || column.type === 'blocks' || ( column.type === 'select' && column.multiple ) ) {
		return [];
	}
	return null;
}

/**
 * What Zero's normaliser gives a member the value does not hold: its declared default, or null.
 * A `now` or function default is computed on the server, so it is reported as unknown here.
 */
function omittedValue( column: DescribedColumn ): { value: unknown } | 'server' | null {
	if ( column.default === undefined ) {
		return null;
	}
	if ( 'value' in column.default ) {
		return { value: column.default.value };
	}
	return 'server';
}

function fieldsToScf( fields: Record< string, DescribedColumn >, row: Record< string, unknown >, site: SiteTime, parentKey: string ): Record< string, unknown > {
	const out: Record< string, unknown > = {};
	for ( const [ name, sub ] of Object.entries( fields ) ) {
		// By field key when one is known (unambiguous); by name only when no key was handed in.
		const subKey = parentKey ? `${ parentKey }_${ name }` : '';
		const outKey = subKey || name;
		let raw = has( row, name ) ? row[ name ] : undefined;
		if ( ! has( row, name ) ) {
			// A member the value does not hold takes its default, as Zero's normaliser does; one the
			// server computes is left to SCF (kept, or absent until the runtime fills it on read).
			const omitted = omittedValue( sub );
			if ( omitted === 'server' ) {
				continue;
			}
			raw = omitted ? omitted.value : undefined;
		}
		const value = toScf( sub, raw, site, subKey );
		if ( value !== null ) {
			out[ outKey ] = value;
		} else {
			const cleared = clearedScf( sub );
			if ( cleared !== null ) {
				out[ outKey ] = cleared;
			}
		}
	}
	return out;
}

/**
 * The pointer of the first member of a structured value that is not in its schema (a misspelled
 * key in a group, repeater row or block), or null. Zero refuses such input with a 422 at that
 * pointer; the screen does the same before encoding, so a typo can never clear the real member.
 */
export function unknownMember( column: DescribedColumn, value: unknown, pointer = '' ): string | null {
	if ( value === null || value === undefined ) {
		return null;
	}
	if ( column.type === 'group' && isRecord( value ) ) {
		return firstUnknown( column.fields ?? {}, value, pointer, [] );
	}
	if ( column.type === 'repeater' && Array.isArray( value ) ) {
		for ( const [ i, row ] of value.entries() ) {
			const found = isRecord( row ) ? firstUnknown( column.fields ?? {}, row, `${ pointer }/${ i }`, [] ) : null;
			if ( found ) {
				return found;
			}
		}
	}
	if ( column.type === 'blocks' && Array.isArray( value ) ) {
		for ( const [ i, row ] of value.entries() ) {
			if ( ! isRecord( row ) ) {
				continue;
			}
			const layout = typeof row.layout === 'string' ? row.layout : null;
			if ( layout === null || ! column.layouts || ! has( column.layouts, layout ) ) {
				return `${ pointer }/${ i }/layout`;
			}
			// SCF's REST output renames a block's members back to their bare names, so a layout that
			// declares a member called like the discriminator can never be read back apart from it,
			// whatever the member holds (null, a default, or a value). Refuse the row up front.
			if ( has( column.layouts[ layout ], 'acf_fc_layout' ) ) {
				return `${ pointer }/${ i }/acf_fc_layout`;
			}
			const found = firstUnknown( column.layouts[ layout ], row, `${ pointer }/${ i }`, [ 'layout' ] );
			if ( found ) {
				return found;
			}
		}
	}
	return null;
}

function has( map: Record< string, unknown >, key: string ): boolean {
	return Object.prototype.hasOwnProperty.call( map, key );
}

function firstUnknown( fields: Record< string, DescribedColumn >, row: Record< string, unknown >, pointer: string, allowed: string[] ): string | null {
	for ( const key of Object.keys( row ) ) {
		if ( ! has( fields, key ) && ! allowed.includes( key ) ) {
			return `${ pointer }/${ key }`;
		}
	}
	for ( const [ name, sub ] of Object.entries( fields ) ) {
		// What will be encoded: the member as given, or the constant default an omitted member takes.
		let value: unknown;
		if ( has( row, name ) ) {
			value = row[ name ];
		} else {
			const omitted = omittedValue( sub );
			if ( omitted === 'server' || omitted === null ) {
				continue;
			}
			value = omitted.value;
		}
		const nested = unknownMember( sub, value, `${ pointer }/${ name }` );
		if ( nested ) {
			return nested;
		}
	}
	return null;
}

/** Empty for a column of this kind: `false` is a value for a boolean and SCF's "nothing" for the rest. */
function isEmptyFor( column: DescribedColumn, value: unknown ): boolean {
	return value === null || value === undefined || value === '' || ( value === false && column.type !== 'boolean' );
}

/**
 * The pointer of the first nested value core cannot clear (a number, boolean, id, email or URL
 * inside a group, repeater row or block, going from a stored value to empty), or null. An empty
 * value that was already empty in `original` is not a clear. The screens refuse such a save with
 * this pointer rather than let SCF keep the old value while reporting success.
 */
export function unclearable( column: DescribedColumn, value: unknown, pointer = '', original?: unknown ): string | null {
	if ( value === null || value === undefined ) {
		return null;
	}
	if ( column.type === 'group' && isRecord( value ) ) {
		return firstUnclearable( column.fields ?? {}, value, pointer, isRecord( original ) ? original : {} );
	}
	if ( column.type === 'repeater' && Array.isArray( value ) ) {
		const rows = Array.isArray( original ) ? original : [];
		for ( const [ i, row ] of value.entries() ) {
			const was = rows[ i ];
			const found = isRecord( row ) ? firstUnclearable( column.fields ?? {}, row, `${ pointer }/${ i }`, isRecord( was ) ? was : {} ) : null;
			if ( found ) {
				return found;
			}
		}
	}
	if ( column.type === 'blocks' && Array.isArray( value ) ) {
		const rows = Array.isArray( original ) ? original : [];
		for ( const [ i, row ] of value.entries() ) {
			const layout = isRecord( row ) && typeof row.layout === 'string' ? row.layout : null;
			const was = rows[ i ];
			const found = layout ? firstUnclearable( column.layouts?.[ layout ] ?? {}, row as Record< string, unknown >, `${ pointer }/${ i }`, isRecord( was ) && was.layout === layout ? was : {} ) : null;
			if ( found ) {
				return found;
			}
		}
	}
	return null;
}

/**
 * A member left out of a structured value means null to Zero (it normalises the omission), so it
 * is judged like an explicit null: against what was stored, every sub-field of the schema.
 */
function firstUnclearable( fields: Record< string, DescribedColumn >, row: Record< string, unknown >, pointer: string, original: Record< string, unknown > ): string | null {
	for ( const [ name, sub ] of Object.entries( fields ) ) {
		let value = has( row, name ) ? row[ name ] : undefined;
		if ( ! has( row, name ) ) {
			const omitted = omittedValue( sub );
			if ( omitted === 'server' ) {
				continue; // the server's value: not a clear
			}
			// An omitted member becomes its constant default, which is then judged like any value: a
			// default of null (or a group default with a null inside) over a stored value is a clear.
			value = omitted ? omitted.value : undefined;
		}
		const was = has( original, name ) ? original[ name ] : undefined;
		if ( isEmptyFor( sub, value ) && clearedScf( sub ) === null && ! isEmptyFor( sub, was ) ) {
			return `${ pointer }/${ name }`;
		}
		const nested = unclearable( sub, value, `${ pointer }/${ name }`, was );
		if ( nested ) {
			return nested;
		}
	}
	return null;
}

/**
 * Sub-fields may come back keyed by bare name, by meta name (`<prefix>_<name>`) or by field key
 * (`field_<prefix>_<name>`). A prefixed key answers for a name only when no longer sibling name
 * also ends it, so `zero_g_parent_id` never answers for `id`.
 */
function fieldsFromScf( fields: Record< string, DescribedColumn >, row: Record< string, unknown >, site: SiteTime ): Record< string, unknown > {
	const out: Record< string, unknown > = {};
	const names = Object.keys( fields );
	for ( const [ name, sub ] of Object.entries( fields ) ) {
		let key: string | null = has( row, name ) ? name : null;
		if ( key === null ) {
			key =
				Object.keys( row ).find(
					( k ) => k.endsWith( `_${ name }` ) && ! names.some( ( other ) => other !== name && other.length > name.length && ( k === other || k.endsWith( `_${ other }` ) ) )
				) ?? null;
		}
		if ( key !== null ) {
			out[ name ] = fromScf( sub, row[ key ], site );
		}
	}
	return out;
}

function isRecord( value: unknown ): value is Record< string, unknown > {
	return typeof value === 'object' && value !== null && ! Array.isArray( value );
}
