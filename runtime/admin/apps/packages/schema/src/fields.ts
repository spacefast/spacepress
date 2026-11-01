import type { Field, Form, Option } from '@zero-admin/dataviews';
import { isShown } from './show-if';
import type { DescribedCollection, DescribedColumn, DescribedGlobal, ViewerSummary } from './types';
import { mayAllow } from './access';

/** A row as the admin holds it: Zero's own column names, whichever API it came from. */
export type Row = Record< string, unknown >;

/** Where the rows of a collection live, as far as generation goes. */
export type Storage = Pick< DescribedCollection, 'primaryKey' > & Partial< Pick< DescribedCollection, 'wp' > >;

/**
 * Columns the row never edits by hand: a generated key (auto-increment, or any key of a post-backed
 * collection, which is the post id), generated core columns, and columns whose default the server
 * computes. A table's hand-written key (`code: text().primaryKey()`) is not generated: a create
 * must supply it.
 */
export function isGenerated( name: string, column: DescribedColumn, collection?: Storage ): boolean {
	const isKey = Boolean( column.primaryKey ) || name === collection?.primaryKey;
	return (
		Boolean( column.autoIncrement ) ||
		( isKey && Boolean( collection?.wp ) ) ||
		// Generated core columns; `status` keeps its choices (draft, published, scheduled) when it has them,
		// and `publishedAt` is the date a scheduled row publishes at, so both stay editable.
		( Boolean( column.system ) && ! column.enum && name !== 'publishedAt' ) ||
		column.default?.now === true ||
		column.default?.fn === true
	);
}

/** Columns whose value is a list (the runtime's LIST_TYPES): filtered with `has`, never `in`. */
export function isList( column: DescribedColumn ): boolean {
	return column.type === 'mediaList' || column.type === 'repeater' || column.type === 'blocks' || ( column.type === 'select' && Boolean( column.multiple ) );
}

/** Columns whose value is structured JSON, edited as JSON text until a dedicated control lands. */
export function isStructured( column: DescribedColumn ): boolean {
	return column.type === 'json' || column.type === 'group' || column.type === 'repeater' || column.type === 'blocks';
}

/** DataViews' field type for a column kind; `null` when DataViews has no control and the admin renders it itself. */
export function fieldType( column: DescribedColumn ): Field< Row >[ 'type' ] | null {
	switch ( column.type ) {
		case 'integer':
			return 'integer';
		case 'real':
			return 'number';
		case 'boolean':
			return 'boolean';
		case 'timestamp':
			return 'datetime';
		case 'date':
			return 'date';
		case 'email':
			return 'email';
		case 'url':
			return 'url';
		case 'media':
			return 'media';
		case 'mediaList':
			return null;
		case 'select':
			return column.multiple ? 'array' : 'text';
		case 'text':
		case 'slug':
			return 'text';
		case 'richText':
		case 'file':
		case 'json':
		case 'group':
		case 'repeater':
		case 'blocks':
			return null;
	}
	return 'text';
}

function label( name: string ): string {
	// camelCase and snake_case column names read as words: `publishedAt` → "Published at".
	const words = name
		.replace( /([a-z0-9])([A-Z])/g, '$1 $2' )
		.replace( /[_-]+/g, ' ' )
		.toLowerCase();
	return words.charAt( 0 ).toUpperCase() + words.slice( 1 );
}

function elements( column: DescribedColumn ): Option[] | undefined {
	if ( column.enum ) {
		return column.enum.map( ( value ) => ( { value, label: value } ) );
	}
	if ( column.type === 'boolean' ) {
		return [
			{ value: true, label: 'Yes' },
			{ value: false, label: 'No' },
		];
	}
	return undefined;
}

/** The JSON text a structured column is edited as; `setValue` parses it back, so the API receives the structure. */
const JSON_TEXT = Symbol( 'json-text' );
type Draft = Row & { [ JSON_TEXT ]?: Record< string, string > };

function jsonText( item: Draft, name: string ): string {
	const draft = item[ JSON_TEXT ]?.[ name ];
	if ( draft !== undefined ) {
		return draft;
	}
	const value = item[ name ];
	// The value is the decoded JSON, whatever its type; a stored string is shown quoted so it parses back.
	return value === undefined || value === null ? '' : JSON.stringify( value, null, 2 );
}

/**
 * One DataViews field per column of a collection or global, for lists and forms alike.
 *
 * - kind → DataViews type (`fieldType`); structured kinds are edited as JSON text that is parsed
 *   back into the value (and refused inline while it does not parse), and never sort or filter.
 * - `enum` → elements; a multi-select or media list is an array of them.
 * - `showIf` → `isVisible`, judged on the sibling values the row holds.
 * - `notNull` without a default → required; `rules` → length and bound checks.
 */
export function fieldsOf(
	columns: Record< string, DescribedColumn >,
	options: { primaryKey?: string; wp?: DescribedCollection[ 'wp' ]; viewer?: ViewerSummary } = {}
): Field< Row >[] {
	const fields: Field< Row >[] = [];
	for ( const [ name, column ] of Object.entries( columns ) ) {
		const type = fieldType( column );
		const field: Field< Row > = {
			id: name,
			label: label( name ),
			type: type ?? undefined,
			enableSorting: type !== null && type !== 'array' && type !== 'media',
			enableGlobalSearch: column.type === 'text' || column.type === 'slug' || column.type === 'email',
			readOnly: isGenerated( name, column, options.primaryKey ? { primaryKey: options.primaryKey, wp: options.wp ?? null } : undefined ),
		};
		const options_ = elements( column );
		if ( options_ ) {
			field.elements = options_;
			// DataViews' membership rule rejects an empty value; a nullable enum or boolean may be empty.
			field.isValid = { ...( field.isValid ?? {} ), elements: false };
		}
		if ( column.type === 'text' && column.multiline ) {
			field.Edit = 'textarea';
		}
		if ( column.type === 'richText' ) {
			field.Edit = 'textarea';
			field.enableSorting = false;
			field.filterBy = false;
		}
		if ( column.type === 'file' ) {
			// A private file's id: an integer, typed by hand until a file picker lands.
			field.type = 'integer';
			field.Edit = 'integer';
			field.filterBy = false;
		}
		if ( column.type === 'media' ) {
			// DataViews has no media control; the client supplies one (`withMediaControls`).
			( field as { accept?: string } ).accept = column.accept;
			field.filterBy = false;
		}
		if ( column.type === 'mediaList' ) {
			// DataViews' array type expects strings; ids are numbers, so validate them here instead.
			field.filterBy = false;
			field.isValid = {
				custom: ( item ) => {
					const value = ( item as Row )[ name ];
					if ( value === undefined || value === null ) {
						return null;
					}
					return Array.isArray( value ) && value.every( ( v ) => Number.isInteger( Number( v ) ) && Number( v ) > 0 ) ? null : 'Every item must be a media id.';
				},
			};
		}
		if ( isStructured( column ) ) {
			field.Edit = 'textarea';
			field.enableSorting = false;
			field.filterBy = false;
			field.getValue = ( { item } ) => jsonText( item as Draft, name );
			field.setValue = ( { item, value } ) => {
				const text = String( value ?? '' );
				const drafts = { ...( ( item as Draft )[ JSON_TEXT ] ?? {} ), [ name ]: text };
				if ( text.trim() === '' ) {
					return { [ name ]: null, [ JSON_TEXT ]: drafts } as Partial< Row >;
				}
				try {
					return { [ name ]: JSON.parse( text ), [ JSON_TEXT ]: drafts } as Partial< Row >;
				} catch {
					// Keep the text so the user can finish typing; the validity rule below holds the save.
					return { [ JSON_TEXT ]: drafts } as Partial< Row >;
				}
			};
			field.isValid = {
				custom: ( item ) => {
					const text = jsonText( item as Draft, name );
					if ( text.trim() === '' ) {
						return null;
					}
					try {
						JSON.parse( text );
						return null;
					} catch {
						return 'Enter valid JSON.';
					}
				},
			};
		}
		if ( column.showIf ) {
			const rule = column.showIf;
			field.isVisible = ( item ) => isShown( rule, item );
		}
		const isValid: NonNullable< Field< Row >[ 'isValid' ] > = { ...( field.isValid ?? {} ) };
		if ( column.notNull && column.default === undefined && ! field.readOnly ) {
			if ( column.type === 'boolean' ) {
				// DataViews reads `required` on a boolean as "must be checked"; a stored false is valid.
				isValid.custom = ( item ) => ( typeof ( item as Row )[ name ] === 'boolean' ? null : 'Choose yes or no.' );
			} else {
				isValid.required = true;
			}
		}
		if ( column.rules?.max !== undefined && ( type === 'text' || type === 'email' || type === 'url' ) ) {
			isValid.maxLength = column.rules.max;
		}
		if ( column.rules?.min !== undefined && ( type === 'text' || type === 'email' || type === 'url' ) ) {
			isValid.minLength = column.rules.min;
		}
		if ( column.rules?.max !== undefined && ( type === 'integer' || type === 'number' ) ) {
			isValid.max = column.rules.max;
		}
		if ( column.rules?.min !== undefined && ( type === 'integer' || type === 'number' ) ) {
			isValid.min = column.rules.min;
		}
		if ( column.rules?.pattern ) {
			isValid.pattern = column.rules.pattern;
		}
		if ( Object.keys( isValid ).length > 0 ) {
			field.isValid = isValid;
		}
		fields.push( field );
	}
	return fields;
}

/** Strip the editing scratch a form carries before a row is sent anywhere. */
export function cleanRow( row: Row ): Row {
	const { [ JSON_TEXT ]: _drafts, ...rest } = row as Draft;
	return rest;
}

/** The columns a table shows by default: the title first, then every plainly readable, non-structured column, up to six. */
export function defaultTableFields( collection: DescribedCollection, viewer: ViewerSummary ): string[] {
	const out: string[] = [];
	if ( collection.title ) {
		out.push( collection.title );
	}
	for ( const [ name, column ] of Object.entries( collection.columns ) ) {
		if ( out.length >= 6 ) {
			break;
		}
		if ( name === collection.title || name === collection.content || name === collection.primaryKey ) {
			continue;
		}
		if ( fieldType( column ) === null || column.type === 'media' || column.type === 'mediaList' ) {
			continue;
		}
		if ( column.access?.read !== undefined && ! mayAllow( column.access.read, viewer ) ) {
			continue;
		}
		out.push( name );
	}
	return out;
}

/**
 * The form for a row: every editable column, in schema order. A content collection's content
 * column is the block editor's, so it is left out when the editor renders beside the form.
 */
export function formOf( columns: Record< string, DescribedColumn >, options: { primaryKey?: string; wp?: DescribedCollection[ 'wp' ]; content?: string | null } = {} ): Form {
	return {
		layout: { type: 'regular', labelPosition: 'top' },
		fields: Object.entries( columns )
			.filter( ( [ name, column ] ) => ! isGenerated( name, column, options.primaryKey ? { primaryKey: options.primaryKey, wp: options.wp ?? null } : undefined ) )
			.filter( ( [ name ] ) => name !== options.content )
			.map( ( [ name ] ) => name ),
	};
}

export function globalFields( global: DescribedGlobal ): Field< Row >[] {
	return fieldsOf( global.fields );
}

/** Columns a create must carry: notNull, no default, not generated. The request still decides. */
export function requiredColumns( collection: Pick< DescribedCollection, 'columns' | 'primaryKey' | 'wp' > ): string[] {
	return Object.entries( collection.columns )
		.filter( ( [ name, column ] ) => column.notNull && column.default === undefined && ! isGenerated( name, column, collection ) )
		.map( ( [ name ] ) => name );
}
