import { useEffect, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { useParams } from '@wordpress/route';
import { Notice, Text } from '@wordpress/ui';
import { Page } from '@zero-admin/admin-toolkit';
import type { Row } from '@zero-admin/schema';
import { changedOnly, RowForm, useZeroContext, zero, ZeroRequestError, type Problem } from '@zero-admin/zero-client';

/** One global: its fields from the schema, its values from `GET /zero/v1/globals/<g>`, saved with `PATCH`. */
export default function GlobalForm() {
	const { global: name } = useParams( { from: '/globals/$global' } ) as { global: string };
	const { schema } = useZeroContext();
	const global = schema?.globals[ name ] ?? null;
	const [ values, setValues ] = useState< Row | null >( null );
	const [ problem, setProblem ] = useState< Problem | null >( null );

	useEffect( () => {
		if ( ! global ) {
			return;
		}
		let cancelled = false;
		setValues( null );
		setProblem( null );
		zero< Row >( 'GET', `/globals/${ encodeURIComponent( name ) }` )
			.then( ( v ) => ! cancelled && setValues( v ) )
			.catch( ( error: unknown ) => ! cancelled && setProblem( error instanceof ZeroRequestError ? error.problem : { status: 0, code: 'error', message: String( error ), field: null } ) );
		return () => {
			cancelled = true;
		};
	}, [ global, name ] );

	if ( ! global ) {
		return (
			<Page title={ name }>
				<Text>{ __( 'This global does not exist in the app.', 'zero-admin' ) }</Text>
			</Page>
		);
	}
	return (
		<Page title={ global.label }>
			{ problem ? (
				<Notice.Root intent="error" role="alert" data-testid="zero-admin-problem" data-code={ problem.code }>
					<Notice.Title>{ problem.message }</Notice.Title>
				</Notice.Root>
			) : ! values ? (
				<Text>{ __( 'Loading…', 'zero-admin' ) }</Text>
			) : (
				<RowForm
					key={ name }
					columns={ global.fields }
					initial={ values }
					mode="edit"
					submitLabel={ __( 'Save', 'zero-admin' ) }
					onSubmit={ async ( next: Row ) => {
						const saved = await zero< Row >( 'PATCH', `/globals/${ encodeURIComponent( name ) }`, { body: changedOnly( values, next ) } );
						setValues( saved );
						return saved;
					} }
					testId="zero-admin-global-form"
				/>
			) }
		</Page>
	);
}
