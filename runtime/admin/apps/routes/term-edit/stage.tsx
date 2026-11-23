import { useParams, useNavigate } from '@wordpress/route';
import { Page, type PageActionConfig } from '@spacepress-admin/admin-toolkit';
import { useViewConfig } from '@spacepress-admin/views';
import { useTaxonomyTermFields } from '@spacepress-admin/fields-next';
import {
	DataForm,
	useFormValidity,
	type ActionModal,
	type Field,
	type Form,
} from '@spacepress-admin/dataviews';
import { useMemo, useCallback } from '@wordpress/element';
import { useSelect, useDispatch } from '@wordpress/data';
import {
	store as coreStore,
	useEntityRecord,
	type Term,
	type Updatable,
} from '@wordpress/core-data';
import { decodeEntities } from '@wordpress/html-entities';
import { __, sprintf } from '@wordpress/i18n';
import { store as noticesStore } from '@wordpress/notices';
import { useTrack } from '@spacepress-admin/telemetry';
import { viewTermAction } from '../term-list/actions/view-term';
import { useDeleteTermAction } from '../term-list/actions/delete-term';

const DEFAULT_FORM: Form = {
	layout: { type: 'regular' },
	fields: [ 'name', 'description', 'slug' ],
};

export default function TermEditStage() {
	const {
		type,
		taxonomy,
		termId,
	}: { type: string; taxonomy: string; termId: string } = useParams( {
		from: '/types/$type/taxonomies/$taxonomy/edit/$termId',
	} );

	const navigate = useNavigate();
	const track = useTrack();
	const deleteTermAction = useDeleteTermAction( taxonomy );
	const taxonomyListPath = `/types/${ type }/taxonomies/${ taxonomy }`;

	const taxonomyObject = useSelect(
		( select ) => select( coreStore ).getTaxonomy( taxonomy ),
		[ taxonomy ]
	);

	const numericTermId = useMemo( () => parseInt( termId, 10 ), [ termId ] );
	const { record, editedRecord, edit, isResolving } = useEntityRecord< Term >(
		'taxonomy',
		taxonomy,
		numericTermId
	);
	const { editForm } = useViewConfig( 'taxonomy', taxonomy );

	const mergedRecord = useMemo( () => {
		if ( ! record ) {
			return undefined;
		}
		return {
			...record,
			...editedRecord,
		} as Term;
	}, [ record, editedRecord ] );

	const canDelete = useSelect(
		( select ) =>
			select( coreStore ).canUser( 'delete', {
				kind: 'taxonomy',
				name: taxonomy,
				id: numericTermId,
			} ),
		[ taxonomy, numericTermId ]
	);

	const { createSuccessNotice, createErrorNotice } =
		useDispatch( noticesStore );
	const { fields, isLoading: isFieldsLoading } =
		useTaxonomyTermFields( taxonomy );

	const form = useMemo< Form >( () => {
		const layout = editForm?.layout ?? DEFAULT_FORM.layout;
		const formFields =
			editForm?.fields && editForm.fields.length > 0
				? editForm.fields
				: DEFAULT_FORM.fields;

		return {
			...DEFAULT_FORM,
			layout,
			fields: formFields,
		};
	}, [ editForm ] );

	const { validity, isValid } = useFormValidity(
		mergedRecord as Updatable< Term > | undefined,
		fields as unknown as Field< Term | undefined >[],
		form
	);

	const isLoading = isResolving || isFieldsLoading || ! mergedRecord;

	const handleSave = useCallback( () => {
		track.buttonClick( 'save' );
		if ( ! mergedRecord ) {
			return;
		}
		createSuccessNotice(
			sprintf(
				// translators: %s is the name of the updated term.
				__( '"%s" updated successfully.', 'spacepress-admin' ),
				mergedRecord.name
			),
			{
				type: 'snackbar',
				id: 'update-term-success',
			}
		);
	}, [ createSuccessNotice, mergedRecord, track ] );

	const handleSaveError = useCallback(
		( error: unknown ) => {
			track.buttonError( 'save', error );
			const message =
				typeof error === 'object' &&
				error !== null &&
				'message' in error &&
				typeof error.message === 'string'
					? decodeEntities( error.message )
					: __( 'Could not save term.', 'spacepress-admin' );

			createErrorNotice( message, {
				type: 'snackbar',
				id: 'update-term-error',
			} );
		},
		[ createErrorNotice, track ]
	);

	const pageActions = useMemo< PageActionConfig< Term >[] >( () => {
		const actions: PageActionConfig< Term >[] = [
			{ action: viewTermAction },
		];

		if ( deleteTermAction && 'RenderModal' in deleteTermAction ) {
			const modalAction: ActionModal< Term > = deleteTermAction;
			actions.push( {
				action: {
					...modalAction,
					isEligible: () => !! canDelete,
				},
				onActionPerformed: () => {
					void navigate( {
						to: taxonomyListPath,
					} );
				},
			} );
		}

		return actions;
	}, [ deleteTermAction, canDelete, navigate, taxonomyListPath ] );

	if ( ! taxonomyObject || isLoading || ! mergedRecord ) {
		return null;
	}

	const taxonomyLabel =
		taxonomyObject.labels?.menu_name || taxonomyObject.name || taxonomy;
	// Use saved record name for breadcrumb to avoid it changing during edits.
	const breadcrumbTermName = record?.name ?? mergedRecord.name;
	const breadcrumbsItems = [
		{
			label: taxonomyLabel,
			to: `/types/${ type }/taxonomies/${ taxonomy }`,
		},
		{
			label: decodeEntities( breadcrumbTermName ?? '' ),
		},
	];
	return (
		<Page
			contentWidth="constrained"
			hasBorder={ true }
			breadcrumbs={ <Page.Breadcrumbs items={ breadcrumbsItems } /> }
			saveButton={ {
				isDisabled: ! isValid,
				isVisible: true,
				onSave: handleSave,
				onError: handleSaveError,
			} }
			entityActions={ {
				entity: mergedRecord,
				actions: pageActions,
			} }
		>
			<DataForm
				data={ mergedRecord as Updatable< Term > }
				fields={ fields }
				form={ form }
				validity={ validity }
				onChange={ ( value ) => {
					edit( value );
				} }
			/>
		</Page>
	);
}
