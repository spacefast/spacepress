import { Link, useParams, useSearch } from '@wordpress/route';
import { Page, unlock } from '@first-admin/admin-toolkit';
import { Button, IconButton } from '@wordpress/ui';
import { usePostFields } from '@first-admin/fields-next';
import { __ } from '@wordpress/i18n';
import { useDispatch, useRegistry, useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { useEffect, useState, useMemo } from '@wordpress/element';
import { DataForm } from '@first-admin/dataviews';
import { Notice } from '@wordpress/components';
import type {
	Field,
	Form as FormType,
	DataFormControlProps,
	DataViewRenderFieldProps,
} from '@first-admin/dataviews';
import type { Post, Updatable } from '@wordpress/core-data';
import { close } from '@wordpress/icons';
import { store as editorStore } from '@wordpress/editor';
// @ts-expect-error Block editor is not typed yet.
import { privateApis as blockEditorPrivateApis } from '@wordpress/block-editor';

const { ExperimentalBlockEditorProvider } = unlock( blockEditorPrivateApis );

function SaveButton( {
	isSaving,
	isSuccess,
	isDirty,
}: {
	isSaving: boolean;
	isSuccess: boolean | undefined;
	isDirty: boolean;
} ) {
	let saveButtonLabel: string = __( 'Save', 'first-admin' );
	if ( isSaving ) {
		saveButtonLabel = __( 'Saving…', 'first-admin' );
	} else if ( isSuccess && ! isDirty ) {
		saveButtonLabel = __( 'Saved!', 'first-admin' );
	}
	return (
		<Button type="submit" disabled={ ! isDirty }>
			{ saveButtonLabel }
		</Button>
	);
}

/**
 * The template field depends on the block editor settings.
 * This is a workaround to ensure that the block editor settings are available.
 * For more information, see: https://github.com/WordPress/gutenberg/issues/67521
 * @param field
 * @param editorSettings
 */
function filterTemplateField(
	field: Field< Updatable< Post > >,
	editorSettings: Object | undefined
) {
	if ( field.id === 'template' && typeof field.Edit === 'function' ) {
		const EditComponent = field.Edit as React.ComponentType<
			DataFormControlProps< Updatable< Post > >
		>;
		return {
			...field,
			Edit: ( props: DataFormControlProps< Updatable< Post > > ) => (
				<ExperimentalBlockEditorProvider settings={ editorSettings }>
					<EditComponent { ...props } />
				</ExperimentalBlockEditorProvider>
			),
		};
	}
	return field;
}

function SingleEdit( {
	postId,
	quickEditForm,
}: {
	postId: string;
	quickEditForm: FormType;
} ) {
	const { type: postType } = useParams( { from: '/types/$type/list/$slug' } );
	const { data, isDirty, isSaving, editorSettings } = useSelect(
		( select ) => {
			if ( ! postId ) {
				return {};
			}
			const edits = select( coreStore ).getEntityRecordEdits(
				'postType',
				postType,
				postId
			);
			return {
				data: select( coreStore ).getEditedEntityRecord(
					'postType',
					postType,
					postId
				) as Updatable< Post > | undefined,
				isSaving: select( coreStore ).isSavingEntityRecord(
					'postType',
					postType,
					postId
				),
				isDirty: edits && Object.keys( edits ).length > 0,
				editorSettings: select( editorStore ).getEditorSettings(),
			};
		},
		[ postType, postId ]
	);
	const {
		fields,
		isLoading: isPostFieldsLoading,
	}: { fields: Field< Updatable< Post > >[]; isLoading: boolean } =
		usePostFields( { postType } );

	const { saveEditedEntityRecord, editEntityRecord } =
		useDispatch( coreStore );
	const [ errorMessage, setErrorMessage ] = useState< string | undefined >();
	const [ isSuccess, setIsSuccess ] = useState< true | undefined >();

	useEffect( () => {
		if ( isDirty ) {
			setIsSuccess( undefined );
		}
	}, [ isDirty ] );

	const mappedFields = useMemo( () => {
		return fields.map( ( field ) =>
			filterTemplateField( field, editorSettings )
		);
	}, [ fields, editorSettings ] );

	if ( ! data || isPostFieldsLoading ) {
		return null;
	}

	async function onSubmit( event: React.FormEvent< HTMLFormElement > ) {
		event.preventDefault();

		try {
			const result = await saveEditedEntityRecord(
				'postType',
				postType,
				postId
			);
			// saveEntityRecord does not throw when the REST API errors.
			if ( ! result ) {
				throw new Error( 'Failed to save post' );
			}
		} catch ( error ) {
			if ( error instanceof Error ) {
				setErrorMessage( error.message );
			}
			return;
		}

		setIsSuccess( true );
	}

	return (
		<form
			className="first-admin-post-list-inspector__form"
			onSubmit={ onSubmit }
		>
			<DataForm
				data={ data }
				fields={ mappedFields }
				form={ quickEditForm }
				onChange={ ( value ) => {
					editEntityRecord( 'postType', postType, postId, value );
				} }
			/>
			<br />
			{ errorMessage && (
				<>
					<Notice status="error" isDismissible={ false }>
						{ errorMessage }
					</Notice>
					<br />
				</>
			) }
			<SaveButton
				isSaving={ isSaving }
				isSuccess={ isSuccess }
				isDirty={ isDirty }
			/>
		</form>
	);
}

function BulkEdit( {
	postIds,
	quickEditForm,
}: {
	postIds: string[];
	quickEditForm: FormType;
} ) {
	const { type: postType } = useParams( { from: '/types/$type/list/$slug' } );
	const { isDirty, isSaving, editorSettings, ...data } = useSelect(
		( select ) => {
			if ( ! postIds.length ) {
				return {
					isDirty: false,
					isSaving: false,
					editorSettings: undefined,
				};
			}
			return {
				...postIds
					.map(
						( postId ) =>
							select( coreStore ).getEditedEntityRecord(
								'postType',
								postType,
								postId
							) as Updatable< Post > | undefined
					)
					.reduce( ( acc, post ) => {
						if ( ! post || ! acc ) {
							return undefined;
						}
						const result = { ...acc } as Updatable< Post >;
						// We need to end up with a single post object that only has
						// values for the properties that are the same for all posts
						// in the array.
						for ( const key in acc ) {
							const field = key as keyof Updatable< Post >;
							if ( result[ field ] !== post[ field ] ) {
								delete result[ field ];
							}
						}
						return result;
					} ),
				isSaving: postIds.some( ( postId ) =>
					select( coreStore ).isSavingEntityRecord(
						'postType',
						postType,
						postId
					)
				),
				isDirty: postIds.some( ( postId ) => {
					const edits = select( coreStore ).getEntityRecordEdits(
						'postType',
						postType,
						postId
					);
					return edits && Object.keys( edits ).length > 0;
				} ),
				editorSettings: select( editorStore ).getEditorSettings(),
			};
		},
		[ postType, postIds ]
	);
	const {
		fields,
		isLoading: isPostFieldsLoading,
	}: { fields: Field< Updatable< Post > >[]; isLoading: boolean } =
		usePostFields( { postType } );
	const registry = useRegistry();
	const { saveEditedEntityRecord, editEntityRecord } =
		useDispatch( coreStore );
	const [ errorMessage, setErrorMessage ] = useState< string | undefined >();
	const [ isSuccess, setIsSuccess ] = useState< true | undefined >();

	useEffect( () => {
		if ( isDirty ) {
			setIsSuccess( undefined );
		}
	}, [ isDirty ] );

	const mappedFields = useMemo( () => {
		return fields
			.map( ( field ) => filterTemplateField( field, editorSettings ) )
			.map( ( field ) => {
				return {
					...field,
					render: (
						props: DataViewRenderFieldProps< Updatable< Post > >
					) => {
						// We need the raw value.
						const value =
							props.item[ field.id as keyof Updatable< Post > ];
						if ( value === undefined ) {
							return __( '(Mixed)', 'first-admin' );
						}
						return field.render ? (
							<field.render { ...props } />
						) : (
							props.field.getValue( props )
						);
					},
				};
			} )
			.filter( ( field ) => field.id !== 'slug' );
	}, [ fields, editorSettings ] );

	if ( ! data || isPostFieldsLoading ) {
		return null;
	}

	async function onSubmit( event: React.FormEvent< HTMLFormElement > ) {
		event.preventDefault();

		try {
			const results = await Promise.all(
				postIds.map( ( postId ) =>
					saveEditedEntityRecord( 'postType', postType, postId )
				)
			);
			// saveEntityRecord does not throw when the REST API errors.
			for ( const result of results ) {
				if ( ! result ) {
					throw new Error( 'Failed to save post' );
				}
			}
		} catch ( error ) {
			if ( error instanceof Error ) {
				setErrorMessage( error.message );
			}
			return;
		}

		setIsSuccess( true );
	}

	return (
		<form onSubmit={ onSubmit }>
			<DataForm
				data={ data as Updatable< Post > }
				fields={ mappedFields }
				form={ quickEditForm }
				onChange={ ( value ) => {
					registry.batch( () => {
						for ( const postId of postIds ) {
							editEntityRecord(
								'postType',
								postType,
								postId,
								value
							);
						}
					} );
				} }
			/>
			<br />
			{ errorMessage && (
				<>
					<Notice status="error" isDismissible={ false }>
						{ errorMessage }
					</Notice>
					<br />
				</>
			) }
			<SaveButton
				isSaving={ isSaving }
				isSuccess={ isSuccess }
				isDirty={ isDirty }
			/>{ ' ' }
			<Button
				variant="outline"
				disabled={ ! isDirty }
				onClick={ async () => {
					for ( const postId of postIds ) {
						const edits = await registry
							.resolveSelect( coreStore )
							.getEntityRecordEdits(
								'postType',
								postType,
								postId
							);
						editEntityRecord(
							'postType',
							postType,
							postId,
							Object.fromEntries(
								Object.entries( edits ).map( ( [ key ] ) => [
									key,
									undefined,
								] )
							)
						);
					}
				} }
			>
				{ __( 'Clear Edits', 'first-admin' ) }
			</Button>
		</form>
	);
}

export default function Inspector() {
	const searchParams = useSearch( { from: '/types/$type/list/$slug' } );

	const { type: postType } = useParams( {
		from: '/types/$type/list/$slug',
	} );

	const postTypeObject = useSelect(
		( select ) => {
			return select( coreStore ).getPostType( postType );
		},
		[ postType ]
	);

	const quickEditForm = postTypeObject?.quick_edit_form;

	if ( ! searchParams.postIds ) {
		return null;
	}

	const isBulk = searchParams.postIds.length > 1;
	const removeEdit = ( search: Record< string, unknown > ) => ( {
		...search,
		edit: undefined,
	} );

	return (
		<Page
			title={
				isBulk
					? __( 'Bulk Edit', 'first-admin' )
					: __( 'Quick Edit', 'first-admin' )
			}
			actions={
				<IconButton
					variant="minimal"
					tone="neutral"
					label={ __( 'Close inspector', 'first-admin' ) }
					icon={ close }
					size="compact"
					render={
						<Link
							to="/types/$type/list/$slug"
							search={ removeEdit }
						/>
					}
				/>
			}
			showSidebarToggle={ false }
		>
			{ isBulk ? (
				<BulkEdit
					postIds={ searchParams.postIds }
					quickEditForm={ quickEditForm ?? {} }
				/>
			) : (
				<SingleEdit
					postId={ searchParams.postIds[ 0 ] }
					quickEditForm={ quickEditForm ?? {} }
				/>
			) }
		</Page>
	);
}
