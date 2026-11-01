import { __, sprintf } from '@wordpress/i18n';
import { useNavigate, useParams } from '@wordpress/route';
import { Notice, Text } from '@wordpress/ui';
import { Page } from '@zero-admin/admin-toolkit';
import { deniedBecause, type Row } from '@zero-admin/schema';
import { createRow, RowForm, useZeroContext } from '@zero-admin/zero-client';

/** A new row: every editable column, required ones marked, created through the guarded API. */
export default function CollectionNew() {
	const { collection: name } = useParams( { from: '/collections/$collection/-/new' } ) as { collection: string };
	const navigate = useNavigate();
	const { schema, viewer, siteTime } = useZeroContext();
	const collection = schema?.collections[ name ] ?? null;
	if ( ! collection ) {
		return (
			<Page title={ name }>
				<Text>{ __( 'This collection does not exist in the app.', 'zero-admin' ) }</Text>
			</Page>
		);
	}
	const denied = deniedBecause( collection.access.create, viewer );
	return (
		<Page title={ sprintf( /* translators: %s: collection label */ __( 'New in %s', 'zero-admin' ), collection.label ) }>
			{ denied && (
				<Notice.Root intent="warning" data-testid="zero-admin-create-denied">
					<Notice.Title>{ sprintf( /* translators: %s: the reason */ __( 'Creating here %s.', 'zero-admin' ), denied ) }</Notice.Title>
				</Notice.Root>
			) }
			<RowForm
				columns={ collection.columns }
				collection={ collection }
				initial={ {} }
				mode="create"
				submitLabel={ __( 'Create', 'zero-admin' ) }
				onSubmit={ ( values: Row ) => createRow( collection, values, siteTime ) }
				onDone={ ( saved ) => {
					const id = saved?.[ collection.primaryKey ];
					if ( id !== undefined ) {
						navigate( { to: `/collections/${ encodeURIComponent( name ) }/${ encodeURIComponent( String( id ) ) }`, replace: true } );
					}
				} }
				testId="zero-admin-new-form"
			/>
		</Page>
	);
}
