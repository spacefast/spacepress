import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/components';
import { store as coreStore } from '@wordpress/core-data';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';
import { useCallback } from '@wordpress/element';
import { type MediaItemUpdatable } from '../../types';

export default function MediaEditorSaveButton( {
	postId,
}: {
	postId: number;
} ) {
	const { post, isDisabled, isEntityRecordDirty, isSaving } = useSelect(
		( select ) => {
			const {
				hasEditsForEntityRecord,
				isSavingEntityRecord,
				getEditedEntityRecord,
			} = select( coreStore );

			const _hasEdits = hasEditsForEntityRecord(
				'postType',
				'attachment',
				postId
			);

			const _isSaving = isSavingEntityRecord(
				'postType',
				'attachment',
				postId
			);

			return {
				isEntityRecordDirty: _hasEdits,
				isSaving: _isSaving,
				isDisabled: _isSaving || ! _hasEdits,
				post: getEditedEntityRecord(
					'postType',
					'attachment',
					postId
				) as MediaItemUpdatable,
			};
		},
		[ postId ]
	);
	const { createSuccessNotice, createErrorNotice } =
		useDispatch( noticesStore );
	const { invalidateResolution, saveEditedEntityRecord } =
		useDispatch( coreStore );

	const reloadAttachment = useCallback( () => {
		// Force the attachment to be re-fetched so that embedded post
		// (parent / attached to) data is up to date.
		invalidateResolution( 'getEntityRecord', [
			'postType',
			'attachment',
			postId,
			{
				_embed: 'wp:attached-to',
			},
		] );
	}, [ invalidateResolution, postId ] );

	const saveAttachment = useCallback( async () => {
		try {
			const response = await saveEditedEntityRecord(
				'postType',
				'attachment',
				postId,
				{ throwOnError: true, isCached: false }
			);
			return response;
		} catch {
			createErrorNotice(
				__( 'Could not save attachment.', 'zero-admin' ),
				{
					id: 'attachment-save-error',
					type: 'snackbar',
				}
			);
		}
	}, [ saveEditedEntityRecord, postId, createErrorNotice ] );

	const saveEditedData = useCallback( async () => {
		if ( ! isEntityRecordDirty ) {
			return;
		}
		const saved = await saveAttachment();
		if ( ! saved ) {
			return;
		}
		createSuccessNotice( __( 'Media saved', 'zero-admin' ), {
			id: 'attachments-save-success',
			type: 'snackbar',
		} );
		reloadAttachment();
	}, [ saveAttachment, isEntityRecordDirty, createSuccessNotice, reloadAttachment ] );

	return (
		<Button
			variant="primary"
			size="compact"
			onClick={ saveEditedData }
			isBusy={ isSaving }
			disabled={ isDisabled }
			accessibleWhenDisabled
		>
			{ __( 'Save', 'zero-admin' ) }
		</Button>
	);
}
