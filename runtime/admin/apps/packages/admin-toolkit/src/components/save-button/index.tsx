import { Button } from '@wordpress/ui';
import { store as coreStore } from '@wordpress/core-data';
import { useRegistry, useSelect } from '@wordpress/data';
import { useRef, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { saveDirtyEntities } from '../../utils/save-dirty-entities';

export type SaveButtonProps = {
	isDisabled?: boolean;
	onSave?: ( values: Array< unknown > ) => void | Promise< void >;
	onError?: ( error: unknown ) => void | Promise< void >;
	label?: string;
};

export default function SaveButton( {
	isDisabled: isDisabledFromProp = false,
	onSave = () => {},
	onError = () => {},
	label = __( 'Save', 'spacepress-admin' ),
}: SaveButtonProps ) {
	const registry = useRegistry();
	const [ isPendingSave, setIsPendingSave ] = useState( false );
	const isPendingSaveRef = useRef( false );

	const { dirtyEntityRecords, isSaving } = useSelect( ( select ) => {
		const { __experimentalGetDirtyEntityRecords, isSavingEntityRecord } =
			select( coreStore );
		const entityRecords = __experimentalGetDirtyEntityRecords();
		return {
			dirtyEntityRecords: entityRecords,
			isSaving: entityRecords.some( ( record ) =>
				isSavingEntityRecord( record.kind, record.name, record.key )
			),
		};
	}, [] );

	const hasChanges = dirtyEntityRecords.length > 0;

	const isSaveButtonDisabled =
		! hasChanges || isDisabledFromProp || isPendingSave || isSaving;
	return (
		<Button
			className="spacepress-admin-save-button"
			loading={ isPendingSave || isSaving }
			disabled={ isSaveButtonDisabled }
			loadingAnnouncement={ __( 'Saving', 'spacepress-admin' ) }
			size="compact"
			onClick={ () => {
				if ( isSaveButtonDisabled || isPendingSaveRef.current ) {
					return;
				}

				isPendingSaveRef.current = true;
				setIsPendingSave( true );
				void saveDirtyEntities( {
					registry,
					dirtyEntityRecords,
				} )
					.then( ( values ) => {
						return onSave( values );
					} )
					.catch( ( error: unknown ) => {
						return onError( error );
					} )
					.finally( () => {
						isPendingSaveRef.current = false;
						setIsPendingSave( false );
					} );
			} }
		>
			{ label }
		</Button>
	);
}
