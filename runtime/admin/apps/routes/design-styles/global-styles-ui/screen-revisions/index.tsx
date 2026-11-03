import { __, sprintf } from '@wordpress/i18n';
import {
	__experimentalConfirmDialog as ConfirmDialog,
	Spinner,
} from '@wordpress/components';
import { useContext, useState, useEffect } from '@wordpress/element';
import './style.scss';
import { ScreenHeader } from '../screen-header';
import { GlobalStylesContext } from '../context';
import { areGlobalStyleConfigsEqual } from '../utils';
import useGlobalStylesRevisions from './use-global-styles-revisions';
import RevisionsButtons from './revisions-buttons';
import Pagination from '../pagination';
// TODO: This component needs to be implemented
// import Revisions from '../../revisions';

const PAGE_SIZE = 10;

interface ScreenRevisionsProps {
	onClose?: () => void;
}

function ScreenRevisions( { onClose }: ScreenRevisionsProps = {} ) {
	const { user: currentEditorGlobalStyles, onChange: setUserConfig } =
		useContext( GlobalStylesContext );
	// Local state instead of zero-admin store dependencies
	const [ _, setViewMode ] = useState< 'revisions' | 'style-book' >(
		'revisions'
	);
	const [ currentPage, setCurrentPage ] = useState( 1 );
	const [ currentRevisions, setCurrentRevisions ] = useState< any[] >( [] );
	const { revisions, isLoading, hasUnsavedChanges, revisionsCount } =
		useGlobalStylesRevisions( {
			query: {
				per_page: PAGE_SIZE,
				page: currentPage,
			},
		} );

	const numPages = Math.ceil( revisionsCount / PAGE_SIZE );

	const [ currentlySelectedRevision, setCurrentlySelectedRevision ] =
		useState( currentEditorGlobalStyles );
	const [
		isLoadingRevisionWithUnsavedChanges,
		setIsLoadingRevisionWithUnsavedChanges,
	] = useState( false );

	const selectedRevisionMatchesEditorStyles = areGlobalStyleConfigsEqual(
		currentlySelectedRevision,
		currentEditorGlobalStyles
	);

	const onCloseRevisions = () => {
		if ( onClose ) {
			onClose();
		}
		setViewMode( 'revisions' );
	};

	const restoreRevision = ( revision: any ) => {
		setUserConfig( revision );
		setIsLoadingRevisionWithUnsavedChanges( false );
		onCloseRevisions();
	};

	useEffect( () => {
		if ( ! isLoading && revisions.length ) {
			setCurrentRevisions( revisions );
		}
	}, [ revisions, isLoading ] );

	const firstRevision = revisions[ 0 ];
	// @ts-expect-error - GlobalStylesConfig type doesn't include id property
	const currentlySelectedRevisionId = currentlySelectedRevision?.id;
	const shouldSelectFirstItem =
		!! firstRevision?.id &&
		! selectedRevisionMatchesEditorStyles &&
		! currentlySelectedRevisionId;

	useEffect( () => {
		/*
		 * Ensure that the first item is selected and loaded into the preview pane
		 * when no revision is selected and the selected styles don't match the current editor styles.
		 * This is required in case editor styles are changed outside the revisions panel,
		 * e.g., via the reset styles function of useGlobalStylesReset().
		 * See: https://github.com/WordPress/gutenberg/issues/55866
		 */
		if ( shouldSelectFirstItem ) {
			setCurrentlySelectedRevision( firstRevision );
		}
	}, [ shouldSelectFirstItem, firstRevision ] );

	// Only display load button if there is a revision to load,
	// and it is different from the current editor styles.
	const isLoadButtonEnabled =
		!! currentlySelectedRevisionId &&
		currentlySelectedRevisionId !== 'unsaved' &&
		! selectedRevisionMatchesEditorStyles;
	const hasRevisions = !! currentRevisions.length;

	return (
		<>
			<ScreenHeader
				title={
					revisionsCount
						? sprintf(
								// translators: %d: number of revisions.
								__( 'Revisions (%d)', 'zero-admin' ),
								revisionsCount
						  )
						: __( 'Revisions', 'zero-admin' )
				}
				description={ __(
					'Click on previously saved styles to preview them. To restore a selected version to the editor, hit "Apply." When you\'re ready, use the Save button to save your changes.',
					'zero-admin'
				) }
				onBack={ onCloseRevisions }
			/>
			{ ! hasRevisions && (
				<Spinner className="zero-admin-global-styles-screen-revisions__loading" />
			) }
			{ 'todo: handle revisions properly' }
			<RevisionsButtons
				onChange={ setCurrentlySelectedRevision }
				selectedRevisionId={ currentlySelectedRevisionId }
				userRevisions={ currentRevisions }
				canApplyRevision={ isLoadButtonEnabled }
				onApplyRevision={ () =>
					hasUnsavedChanges
						? setIsLoadingRevisionWithUnsavedChanges( true )
						: restoreRevision( currentlySelectedRevision )
				}
			/>
			{ numPages > 1 && (
				<div className="zero-admin-global-styles-screen-revisions__footer">
					<Pagination
						className="zero-admin-global-styles-screen-revisions__pagination"
						currentPage={ currentPage }
						numPages={ numPages }
						changePage={ setCurrentPage }
						totalItems={ revisionsCount }
						disabled={ isLoading }
						label={ __( 'Global Styles pagination', 'zero-admin' ) }
					/>
				</div>
			) }
			{ isLoadingRevisionWithUnsavedChanges && (
				<ConfirmDialog
					isOpen={ isLoadingRevisionWithUnsavedChanges }
					confirmButtonText={ __( 'Apply', 'zero-admin' ) }
					onConfirm={ () =>
						restoreRevision( currentlySelectedRevision )
					}
					onCancel={ () =>
						setIsLoadingRevisionWithUnsavedChanges( false )
					}
					size="medium"
				>
					{ __(
						'Are you sure you want to apply this revision? Any unsaved changes will be lost.',
						'zero-admin'
					) }
				</ConfirmDialog>
			) }
		</>
	);
}

export default ScreenRevisions;
