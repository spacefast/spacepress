import { useEffect, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { useParams } from '@wordpress/route';
import { Notice, Text } from '@wordpress/ui';
import { Page } from '@zero-admin/admin-toolkit';
import type { Row } from '@zero-admin/schema';
import { changedOnly, getRow, RowForm, updateRow, useZeroContext, ZeroRequestError, type Problem } from '@zero-admin/zero-client';

/**
 * One row by its key. The form renders the columns the response carried: a column the viewer may
 * not read is absent and never shown; a column the viewer may not write comes back as a 403 whose
 * pointer the form shows inline. Only what changed is sent.
 */
export default function CollectionEdit( { embedded = false }: { embedded?: boolean } ) {
	const { collection: name, id } = useParams( { from: '/collections/$collection/$id' } ) as { collection: string; id: string };
	const { schema, siteTime } = useZeroContext();
	const collection = schema?.collections[ name ] ?? null;
	const [ row, setRow ] = useState< Row | null >( null );
	const [ problem, setProblem ] = useState< Problem | null >( null );

	useEffect( () => {
		if ( ! collection ) {
			return;
		}
		let cancelled = false;
		setRow( null );
		setProblem( null );
		getRow( collection, id, siteTime )
			.then( ( r ) => ! cancelled && setRow( r ) )
			.catch( ( error: unknown ) => ! cancelled && setProblem( error instanceof ZeroRequestError ? error.problem : { status: 0, code: 'error', message: String( error ), field: null } ) );
		return () => {
			cancelled = true;
		};
	}, [ collection, id, siteTime ] );

	if ( ! collection ) {
		return (
			<Page title={ name }>
				<Text>{ __( 'This collection does not exist in the app.', 'zero-admin' ) }</Text>
			</Page>
		);
	}
	const title = row && collection.title ? String( row[ collection.title ] ?? id ) : `${ collection.label } ${ id }`;
	const body = problem ? (
		<Notice.Root intent="error" role="alert" data-testid="zero-admin-problem" data-code={ problem.code }>
			<Notice.Title>{ problem.message }</Notice.Title>
		</Notice.Root>
	) : ! row ? (
		<Text>{ __( 'Loading…', 'zero-admin' ) }</Text>
	) : (
		<RowForm
			key={ `${ name }/${ id }` }
			columns={ collection.columns }
			collection={ collection }
			contentInEditor={ Boolean( collection.wp && collection.content ) }
			initial={ row }
			mode="edit"
			submitLabel={ __( 'Save', 'zero-admin' ) }
			onSubmit={ async ( values: Row ) => {
				const saved = await updateRow( collection, id, changedOnly( row, values ), { site: siteTime, full: values, original: row } );
				setRow( saved );
				return saved;
			} }
			testId="zero-admin-edit-form"
		/>
	);
	if ( embedded ) {
		return body;
	}
	return <Page title={ title }>{ body }</Page>;
}
