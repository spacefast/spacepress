/**
 * A screen declaration as `GET /wp-json/first-admin/v1/screens/<id>` returns it
 * (runtime/admin/lib/screens.php), and the pure steps both hosts share: reading
 * the items out of an ability's output and filling an action's input from an item.
 */

export interface ScreenField {
	id: string;
	label?: string;
	type?: 'text' | 'integer' | 'number' | 'boolean' | 'datetime' | 'array';
	elements?: { value: string | number; label: string }[];
	description?: string;
}

export interface ScreenAction {
	id: string;
	label: string;
	/** The Ability the action runs, `<category>/<name>`. */
	ability: string;
	/** The ability's input; string values may name `{item.<field>}`. */
	input?: Record< string, unknown >;
	destructive?: boolean;
	/** A sentence asked before the action runs. */
	confirm?: string;
}

export interface ScreenSource {
	/** A read-only Ability that returns the data. */
	ability: string;
	input?: Record< string, unknown >;
	fields: ScreenField[];
}

export interface ScreenView extends ScreenSource {
	/** Dot path to the list in the output; absent when the output is the list. */
	items?: string;
	/** The item key. Default `id`. */
	id?: string;
	/** A DataViews view: `type`, `fields`, `sort`, `perPage`. */
	layout?: Record< string, unknown >;
}

export interface ScreenForm extends ScreenSource {
	/** Dot path to the values in the output; absent when the output is the values. */
	item?: string;
	/** A DataForm form. */
	layout?: Record< string, unknown >;
	submit?: ScreenAction;
}

export interface Screen {
	id: string;
	title: string;
	description: string;
	view: ScreenView | null;
	form: ScreenForm | null;
	actions: ScreenAction[];
	data: unknown;
}

export type Item = Record< string, unknown >;

/** The value at a dot path (`versions`, `data.rows`); the whole value for an empty path. */
export function at( value: unknown, path?: string ): unknown {
	if ( ! path ) {
		return value;
	}
	return path.split( '.' ).reduce< unknown >(
		( v, key ) =>
			v !== null && typeof v === 'object'
				? ( v as Record< string, unknown > )[ key ]
				: undefined,
		value
	);
}

/** The items a view lists from its ability's output. */
export function items( view: ScreenView, output: unknown ): Item[] {
	const list = at( output, view.items );
	if ( ! Array.isArray( list ) ) {
		throw new Error(
			`The ${ view.ability } output has no list at "${ view.items ?? '' }".`
		);
	}
	return list.filter(
		( v ): v is Item => v !== null && typeof v === 'object'
	);
}

const PLACEHOLDER = /^\{item\.([A-Za-z0-9_.]+)\}$/;

/**
 * An action's input with `{item.<field>}` placeholders filled from the item. A
 * placeholder is the whole string, so the field keeps its type.
 */
export function actionInput(
	action: ScreenAction,
	item: Item | null
): Record< string, unknown > {
	const fill = ( value: unknown ): unknown => {
		if ( typeof value === 'string' ) {
			const m = PLACEHOLDER.exec( value );
			return m ? at( item, m[ 1 ] ) : value;
		}
		if ( Array.isArray( value ) ) {
			return value.map( fill );
		}
		if ( value !== null && typeof value === 'object' ) {
			return Object.fromEntries(
				Object.entries( value ).map( ( [ k, v ] ) => [ k, fill( v ) ] )
			);
		}
		return value;
	};
	return fill( action.input ?? {} ) as Record< string, unknown >;
}

/** A read-only ability runs over GET with its input in the query, as core's run route expects. */
export function readPath( source: ScreenSource ): string {
	const base = `/wp-abilities/v1/abilities/${ source.ability }/run`;
	const input = source.input ?? {};
	if ( Object.keys( input ).length === 0 ) {
		return base;
	}
	const query = new URLSearchParams();
	const add = ( prefix: string, value: unknown ) => {
		if ( value === null || value === undefined ) {
			return; // A query string has no null: leave the key out, as the ability's default.
		}
		if ( typeof value === 'object' ) {
			for ( const [ k, v ] of Object.entries( value ) ) {
				add( `${ prefix }[${ k }]`, v );
			}
		} else {
			query.append( prefix, String( value ) );
		}
	};
	for ( const [ k, v ] of Object.entries( input ) ) {
		add( `input[${ k }]`, v );
	}
	return `${ base }?${ query.toString() }`;
}

/** The DataViews type for a declared field type. */
export function fieldType( type: ScreenField[ 'type' ] ): string {
	return type === 'array' ? 'text' : type ?? 'text';
}

/** How a value reads in a cell or a summary line. */
export function display( value: unknown ): string {
	if ( value == null ) {
		return '—';
	}
	if ( Array.isArray( value ) ) {
		return value.map( display ).join( '\n' );
	}
	return typeof value === 'object' ? JSON.stringify( value ) : String( value );
}

/** Items in the view's sort order: numbers as numbers, everything else as text. */
export function sorted(
	list: Item[],
	sort?: { field: string; direction: 'asc' | 'desc' }
): Item[] {
	if ( ! sort?.field ) {
		return list;
	}
	const sign = sort.direction === 'desc' ? -1 : 1;
	return [ ...list ].sort( ( a, b ) => {
		const x = a[ sort.field ];
		const y = b[ sort.field ];
		if ( typeof x === 'number' && typeof y === 'number' ) {
			return ( x - y ) * sign;
		}
		return display( x ).localeCompare( display( y ) ) * sign;
	} );
}
