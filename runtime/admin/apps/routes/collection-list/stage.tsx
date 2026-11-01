import { useMemo, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { trash } from '@wordpress/icons';
import { useNavigate, useParams } from '@wordpress/route';
import { Button, Notice, Text } from '@wordpress/ui';
import { Page, RouterLink } from '@zero-admin/admin-toolkit';
import type { Action, View } from '@zero-admin/dataviews';
import { DataViews } from '@zero-admin/views';
import { defaultTableFields, deniedBecause, fieldsOf, mayAllow, type Row } from '@zero-admin/schema';
import { deleteRow, useRows, useZeroContext, ZeroRequestError } from '@zero-admin/zero-client';

/**
 * A collection's rows in DataViews, read through the API that guards them. The fields come from
 * the schema; what each row carries comes from the response, so a column the viewer may not read
 * is simply empty. Free-text search on a table collection matches the title column only.
 */
/** The list keeps per-collection view state; a new collection is a new list. */
export default function CollectionListRoute() {
	const { collection: name } = useParams( { from: '/collections/$collection' } ) as { collection: string };
	return <CollectionList key={ name } name={ name } />;
}

function CollectionList( { name }: { name: string } ) {
	const navigate = useNavigate();
	const { schema, viewer, siteTime } = useZeroContext();
	const collection = schema?.collections[ name ] ?? null;
	const [ view, setView ] = useState< View >( () => ( {
		type: 'table',
		page: 1,
		perPage: 20,
		fields: collection ? defaultTableFields( collection, viewer ) : [],
		sort: collection?.primaryKey ? { field: collection.primaryKey, direction: 'desc' } : undefined,
	} ) );
	const [ problem, setProblem ] = useState< string | null >( null );
	const fields = useMemo( () => ( collection ? fieldsOf( collection.columns, { primaryKey: collection.primaryKey, viewer } ) : [] ), [ collection, viewer ] );
	const { rows, totalItems, totalPages, droppedFilters, droppedSort, isLoading, problem: listProblem, reload } = useRows( collection, view, siteTime );

	if ( ! collection ) {
		return (
			<Page title={ name }>
				<Text>{ __( 'This collection does not exist in the app.', 'zero-admin' ) }</Text>
			</Page>
		);
	}
	const key = collection.primaryKey;
	const createDenied = deniedBecause( collection.access.create, viewer );
	const actions: Action< Row >[] = [
		{
			id: 'edit',
			label: __( 'Edit', 'zero-admin' ),
			isPrimary: true,
			callback: ( items ) => {
				if ( items[ 0 ] ) {
					navigate( { to: `/collections/${ encodeURIComponent( name ) }/${ encodeURIComponent( String( items[ 0 ][ key ] ) ) }` } );
				}
			},
		},
		{
			id: 'delete',
			label: __( 'Delete', 'zero-admin' ),
			icon: trash,
			supportsBulk: true,
			isEligible: () => mayAllow( collection.access.delete, viewer ),
			callback: async ( items ) => {
				setProblem( null );
				try {
					for ( const item of items ) {
						await deleteRow( collection, String( item[ key ] ) );
					}
				} catch ( error ) {
					setProblem( error instanceof ZeroRequestError ? error.problem.message : String( error ) );
				}
				reload();
			},
		},
	];

	return (
		<Page
			title={ collection.label }
			subTitle={ collection.wp ? undefined : view.search ? __( 'Search matches the title column.', 'zero-admin' ) : undefined }
			actions={
				collection.api.create !== false && (
					<Button
						variant="solid"
						size="compact"
						disabled={ createDenied !== null }
						title={ createDenied ?? undefined }
						data-testid="zero-admin-new"
						onClick={ () => navigate( { to: `/collections/${ encodeURIComponent( name ) }/-/new` } ) }
					>
						{ createDenied ? sprintf( /* translators: %s: the reason */ __( 'New (%s)', 'zero-admin' ), createDenied ) : __( 'New', 'zero-admin' ) }
					</Button>
				)
			}
			hasPadding={ false }
		>
			{ ( problem || listProblem ) && (
				<Notice.Root intent="error" role="alert" data-testid="zero-admin-problem">
					<Notice.Title>{ problem ?? listProblem?.message }</Notice.Title>
				</Notice.Root>
			) }
			{ droppedSort && (
				<Notice.Root intent="warning" data-testid="zero-admin-dropped-sort">
					<Notice.Title>
						{ sprintf( /* translators: %s: field name */ __( 'This collection cannot be sorted by %s here; the list keeps its default order.', 'zero-admin' ), droppedSort ) }
					</Notice.Title>
				</Notice.Root>
			) }
			{ droppedFilters.length > 0 && (
				<Notice.Root intent="warning" data-testid="zero-admin-dropped-filters">
					<Notice.Title>
						{ sprintf(
							/* translators: %s: comma-separated field names */
							__( 'This collection cannot be filtered by %s here; the list is unfiltered on those fields.', 'zero-admin' ),
							droppedFilters.join( ', ' )
						) }
					</Notice.Title>
				</Notice.Root>
			) }
			<DataViews< Row >
				data={ rows }
				fields={ fields }
				view={ view }
				onChangeView={ setView }
				actions={ actions }
				isLoading={ isLoading }
				paginationInfo={ { totalItems, totalPages } }
				defaultLayouts={ { table: {} } }
				getItemId={ ( item ) => String( item[ key ] ) }
				renderItemLink={ ( { item, ...props } ) => (
					<RouterLink to={ `/collections/${ encodeURIComponent( name ) }/${ encodeURIComponent( String( item[ key ] ) ) }` } { ...props } />
				) }
				showLayoutSwitcher={ false }
			/>
		</Page>
	);
}
