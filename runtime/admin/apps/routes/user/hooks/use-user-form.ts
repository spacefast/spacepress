import { useFieldCollections } from '@zero-admin/core-data-next';
import { __ } from '@wordpress/i18n';
import { select, useDispatch, useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { useEffect, useState } from '@wordpress/element';
import type { User, Updatable } from '@wordpress/core-data';
import { isInviteUser } from '../utils';
import type { ExtendedUser } from '../types';

interface UserFormProps {
	data: Updatable< User > | undefined;
	isDirty: boolean;
	isSaving: boolean;
	errorMessage: string;
	isSuccess: boolean;
	saveButtonLabel: string;
	fields: ReturnType< typeof useFieldCollections >;
	handleOnChange: ( value: Partial< User > ) => void;
	handleSubmit: () => Promise< void >;
}

export function useUserForm( userId: number ): UserFormProps {
	const {
		data,
		isDirty = false,
		isSaving = false,
	} = useSelect( () => {
		if ( ! userId ) {
			return {};
		}

		// For invite users (negative IDs), read directly from the
		// entity item store. The route loader populates this via
		// getEntityRecords, but getEntityRecords clips results to
		// perPage (default 10) which excludes invites appended by
		// the PHP REST filter beyond that limit. getEntityRecord
		// bypasses the pagination clipping.
		if ( isInviteUser( userId ) ) {
			const inviteUserData = select( coreStore ).getEntityRecord(
				'root',
				'user',
				userId
			);

			return {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- getEntityRecord returns wide EntityRecord type
				data: inviteUserData as Updatable< ExtendedUser > | undefined,
				isSaving: false,
				isDirty: false,
			};
		}

		// For regular users, use entity record with edit capabilities
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- getEditedEntityRecord returns wide EntityRecord type
		const entityData = select( coreStore ).getEditedEntityRecord(
			'root',
			'user',
			userId
		) as Updatable< User > | undefined;

		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- getEntityRecordEdits returns Optional<any>
		const edits = select( coreStore ).getEntityRecordEdits(
			'root',
			'user',
			userId
		);
		return {
			data: entityData,
			isSaving: select( coreStore ).isSavingEntityRecord(
				'root',
				'user',
				userId
			),
			isDirty:
				edits !== undefined &&
				// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- edits is Optional<any> from core-data
				Object.keys( edits as Record< string, unknown > ).length > 0,
		};
	}, [ userId ] );

	const fields = useFieldCollections( 'root', 'user' );
	const { saveEditedEntityRecord, editEntityRecord } =
		useDispatch( coreStore );

	const [ errorMessage, setErrorMessage ] = useState< string >( '' );
	const [ isSuccess, setIsSuccess ] = useState< boolean >( false );

	let saveButtonLabel: string = __( 'Save', 'zero-admin' );
	if ( isSaving ) {
		saveButtonLabel = __( 'Saving…', 'zero-admin' );
	} else if ( isSuccess && ! isDirty ) {
		saveButtonLabel = __( 'Saved!', 'zero-admin' );
	}

	async function handleSubmit() {
		try {
			await saveEditedEntityRecord( 'root', 'user', userId, {
				throwOnError: true,
			} );
			setIsSuccess( true );
		} catch ( error: unknown ) {
			if (
				error &&
				typeof error === 'object' &&
				'message' in error &&
				typeof error.message === 'string'
			) {
				setErrorMessage( error.message );
			} else {
				setErrorMessage( String( error ) );
			}
		}
	}

	useEffect( () => {
		if ( isDirty ) {
			setIsSuccess( false );
		}
	}, [ isDirty ] );

	return {
		data,
		isDirty,
		isSaving,
		errorMessage,
		isSuccess,
		saveButtonLabel,
		fields,
		handleOnChange: ( value ) => {
			// Don't allow changes for invite users (read-only)
			if ( isInviteUser( data ) ) {
				return;
			}
			void editEntityRecord( 'root', 'user', userId, value );
		},
		handleSubmit,
	};
}
