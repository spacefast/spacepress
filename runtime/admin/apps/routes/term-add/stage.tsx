import { useNavigate, useParams } from '@wordpress/route';
import { Page } from '@typedpress-admin/admin-toolkit';
import { Button } from '@wordpress/ui';
import { useTaxonomyTermFields } from '@typedpress-admin/fields-next';
import { useViewConfig } from '@typedpress-admin/views';
import {
	DataForm,
	useFormValidity,
	type Field,
	type Form,
} from '@typedpress-admin/dataviews';
import type { FormEvent } from 'react';
import { useCallback, useMemo, useState } from '@wordpress/element';
import { useSelect, useDispatch } from '@wordpress/data';
import {
	store as coreStore,
	type Term,
	type Updatable,
} from '@wordpress/core-data';
import { decodeEntities } from '@wordpress/html-entities';
import { __, sprintf } from '@wordpress/i18n';
import { Notice } from '@wordpress/components';
import { store as noticesStore } from '@wordpress/notices';

const DEFAULT_FORM: Form = {
	layout: { type: 'regular' },
	fields: [ 'name', 'description', 'slug' ],
};

export default function TermAddStage() {
	const navigate = useNavigate();
	const { type, taxonomy } = useParams( {
		from: '/types/$type/taxonomies/$taxonomy/add',
	} );

	const taxonomyObject = useSelect(
		( select ) => select( coreStore ).getTaxonomy( taxonomy ),
		[ taxonomy ]
	);

	const { fields, isLoading: isFieldsLoading } =
		useTaxonomyTermFields( taxonomy );
	const { addForm } = useViewConfig( 'taxonomy', taxonomy );
	const { createSuccessNotice } = useDispatch( noticesStore );
	const { saveEntityRecord } = useDispatch( coreStore );

	const [ termData, setTermData ] = useState< Partial< Updatable< Term > > >(
		() => ( {
			name: '',
			description: '',
			slug: '',
		} )
	);
	const [ errorMessage, setErrorMessage ] = useState< string | undefined >();
	const [ isSaving, setIsSaving ] = useState( false );

	const form = useMemo< Form >( () => {
		const layout = addForm?.layout ?? DEFAULT_FORM.layout;
		const formFields =
			addForm?.fields && addForm.fields.length > 0
				? addForm.fields
				: DEFAULT_FORM.fields;

		return {
			...DEFAULT_FORM,
			layout,
			fields: formFields,
		};
	}, [ addForm ] );

	const typedFields = useMemo(
		() => ( fields ?? [] ) as Field< Updatable< Term > >[],
		[ fields ]
	);
	const updatableTermData = termData as Updatable< Term >;
	const { validity, isValid } = useFormValidity(
		updatableTermData,
		typedFields,
		form
	);

	const canSave = useMemo( () => {
		if ( isSaving || isFieldsLoading ) {
			return false;
		}
		const hasValues = [
			termData.name ?? '',
			termData.description ?? '',
			termData.slug ?? '',
		].some( Boolean );
		return isValid && hasValues;
	}, [ isValid, termData, isSaving, isFieldsLoading ] );

	const submit = useCallback( async () => {
		if ( ! canSave ) {
			return false;
		}

		setIsSaving( true );
		setErrorMessage( undefined );

		try {
			const createdTerm = ( await saveEntityRecord(
				'taxonomy',
				taxonomy,
				termData,
				{ throwOnError: true }
			) ) as Term;

			createSuccessNotice(
				sprintf(
					// translators: %s is the name of the created term.
					__( '"%s" created successfully.', 'typedpress-admin' ),
					createdTerm.name
				),
				{
					type: 'snackbar',
					id: 'create-term-success',
				}
			);

			if ( createdTerm?.id ) {
				await navigate( {
					to: '/types/$type/taxonomies/$taxonomy/edit/$termId',
					params: {
						type,
						taxonomy,
						termId: createdTerm.id.toString(),
					},
				} );
			} else {
				await navigate( {
					to: '/types/$type/taxonomies/$taxonomy',
					params: {
						type,
						taxonomy,
					},
				} );
			}

			return true;
		} catch ( error ) {
			setErrorMessage( decodeEntities( ( error as Error ).message ) );
			return false;
		} finally {
			setIsSaving( false );
		}
	}, [
		canSave,
		saveEntityRecord,
		taxonomy,
		termData,
		createSuccessNotice,
		navigate,
		type,
	] );

	const onSubmit = useCallback(
		async ( event: FormEvent< HTMLFormElement > ) => {
			event.preventDefault();
			await submit();
		},
		[ submit ]
	);

	const taxonomyLabel =
		taxonomyObject?.labels?.menu_name || taxonomyObject?.name || taxonomy;

	const addLabel =
		taxonomyObject?.labels?.add_new_item || __( 'Add New', 'typedpress-admin' );

	if ( ! taxonomyObject || isFieldsLoading ) {
		return null;
	}

	return (
		<Page
			contentWidth="constrained"
			hasBorder={ true }
			breadcrumbs={
				<Page.Breadcrumbs
					items={ [
						{
							label: taxonomyLabel,
							to: `/types/${ type }/taxonomies/${ taxonomy }`,
						},
						{
							label: addLabel,
						},
					] }
				/>
			}
			actions={
				<Button
					variant="solid"
					size="compact"
					onClick={ async () => {
						await submit();
					} }
					disabled={ ! canSave }
				>
					{ __( 'Save', 'typedpress-admin' ) }
				</Button>
			}
		>
			<form onSubmit={ onSubmit }>
				{ /* TODO: Temporary notice until unified error handling lands. */ }
				{ errorMessage && (
					<>
						<Notice status="error" isDismissible={ false }>
							{ errorMessage }
						</Notice>
						<br />
					</>
				) }
				<DataForm
					data={ updatableTermData }
					fields={ typedFields }
					form={ form }
					validity={ validity }
					onChange={ ( value ) => {
						setTermData( ( previous ) => ( {
							...previous,
							...value,
						} ) );
					} }
				/>
			</form>
		</Page>
	);
}
