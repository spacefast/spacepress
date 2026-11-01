import { useMemo, useState } from '@wordpress/element';
import { Button, Notice, Text } from '@wordpress/ui';
import { DataForm, useFormValidity, type Field } from '@zero-admin/dataviews';
import { fieldsOf, formOf, type DescribedCollection, type DescribedColumn, type Row } from '@zero-admin/schema';
import { ZeroRequestError } from '../api';
import type { Problem } from '../problem';
import { MediaControl, MediaListControl } from './media-control';

/** DataViews has no media control; give media columns the admin's picker. */
export function withMediaControls( fields: Field< Row >[], columns: Record< string, DescribedColumn > ): Field< Row >[] {
	return fields.map( ( field ) => {
		const kind = columns[ field.id ]?.type;
		if ( kind === 'media' ) {
			return { ...field, Edit: MediaControl };
		}
		if ( kind === 'mediaList' ) {
			return { ...field, Edit: MediaListControl };
		}
		return field;
	} );
}

/**
 * One form for a row (or a global): the editable columns of the schema, rendered on the values the
 * API returned. A column the viewer could not read is absent from the values and the form does
 * not invent it; a refused write shows the problem next to the field its pointer names.
 */
export function RowForm( {
	columns,
	collection,
	initial,
	mode,
	contentInEditor = false,
	submitLabel,
	onSubmit,
	onDone,
	testId,
}: {
	columns: Record< string, DescribedColumn >;
	collection?: Pick< DescribedCollection, 'primaryKey' | 'wp' > & { content?: string | null };
	initial: Row;
	/** `create`: every editable column; `edit`: only the columns the response carried. */
	mode: 'create' | 'edit';
	/** The content column is left to the block editor beside the form; otherwise the form holds it. */
	contentInEditor?: boolean;
	submitLabel: string;
	onSubmit: ( values: Row ) => Promise< Row | void >;
	onDone?: ( saved: Row | void ) => void;
	testId?: string;
} ) {
	const [ values, setValues ] = useState< Row >( initial );
	const [ problem, setProblem ] = useState< Problem | null >( null );
	const [ saved, setSaved ] = useState( false );
	const [ busy, setBusy ] = useState( false );

	const fields = useMemo( () => {
		const all = withMediaControls( fieldsOf( columns, { primaryKey: collection?.primaryKey, wp: collection?.wp ?? null } ), columns );
		// A hand-written key is typed on create and fixed afterwards.
		return mode === 'edit' && collection?.primaryKey ? all.map( ( f ) => ( f.id === collection.primaryKey ? { ...f, readOnly: true } : f ) ) : all;
	}, [ columns, collection?.primaryKey, collection?.wp, mode ] );
	const form = useMemo( () => {
		const base = formOf( columns, { primaryKey: collection?.primaryKey, wp: collection?.wp ?? null, content: contentInEditor ? collection?.content ?? null : null } );
		// Editing renders only the columns the response carried: a column the viewer may not read is
		// absent, and the form does not invent it. Creating renders every editable column.
		const present = Object.keys( initial );
		const fieldsToShow = mode === 'edit' ? ( base.fields as string[] ).filter( ( id ) => present.includes( id ) ) : ( base.fields as string[] );
		return { ...base, fields: fieldsToShow };
	}, [ columns, collection?.primaryKey, collection?.wp, collection?.content, contentInEditor, initial, mode ] );
	const visibleFields = useMemo( () => fields.filter( ( f ) => ( form.fields as string[] ).includes( f.id ) ), [ fields, form ] );
	const { isValid } = useFormValidity( values, visibleFields as Field< Row >[], form );

	const submit = async ( event: React.FormEvent ) => {
		event.preventDefault();
		setBusy( true );
		setProblem( null );
		setSaved( false );
		try {
			const result = await onSubmit( values );
			setSaved( true );
			onDone?.( result );
		} catch ( error ) {
			setProblem( error instanceof ZeroRequestError ? error.problem : { status: 0, code: 'error', message: String( error ), field: null } );
		} finally {
			setBusy( false );
		}
	};

	const fieldLabel = ( id: string | null ) => ( id ? fields.find( ( f ) => f.id === id || `acf/zero_${ f.id }` === id )?.label ?? id : null );

	return (
		<form onSubmit={ submit } data-testid={ testId } className="zero-admin-row-form">
			<DataForm< Row > data={ values } fields={ visibleFields } form={ form } onChange={ ( edits ) => { setSaved( false ); setValues( ( v ) => ( { ...v, ...edits } ) ); } } />
			{ problem && (
				<Notice.Root intent="error" role="alert" data-testid="zero-admin-problem" data-code={ problem.code } data-field={ problem.field ?? undefined }>
					<Notice.Title>{ fieldLabel( problem.field ) ? `${ fieldLabel( problem.field ) }: ${ problem.message }` : problem.message }</Notice.Title>
				</Notice.Root>
			) }
			{ saved && ! problem && (
				<Text variant="body-sm" role="status">Saved.</Text>
			) }
			<Button type="submit" disabled={ busy || ! isValid }>{ submitLabel }</Button>
		</form>
	);
}
