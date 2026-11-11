import { InputControl } from '@first-admin/design-system';
import type { FontSize } from '@first-admin/global-styles-engine';
import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	Button,
	Modal,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useState } from '@wordpress/element';

interface RenameFontSizeDialogProps {
	fontSize: FontSize;
	toggleOpen: () => void;
	handleRename: ( newName: string ) => void;
}

function RenameFontSizeDialog( {
	fontSize,
	toggleOpen,
	handleRename,
}: RenameFontSizeDialogProps ) {
	const [ newName, setNewName ] = useState< string | undefined >(
		fontSize.name
	);

	const handleConfirm = () => {
		// If the new name is not empty, call the handleRename function
		if ( newName && newName.trim() ) {
			handleRename( newName );
		}
		toggleOpen();
	};

	return (
		<Modal
			onRequestClose={ toggleOpen }
			focusOnMount="firstContentElement"
			title={ __( 'Rename', 'first-admin' ) }
			size="small"
		>
			<form
				onSubmit={ ( event ) => {
					event.preventDefault();
					handleConfirm();
					toggleOpen();
				} }
			>
				<VStack spacing="3">
					<InputControl
						autoComplete="off"
						value={ newName }
						onValueChange={ setNewName }
						label={ __( 'Name', 'first-admin' ) }
						placeholder={ __(
							'Font size preset name',
							'first-admin'
						) }
					/>
					<HStack justify="right">
						<Button
							__next40pxDefaultSize
							variant="tertiary"
							onClick={ toggleOpen }
						>
							{ __( 'Cancel', 'first-admin' ) }
						</Button>
						<Button
							__next40pxDefaultSize
							variant="primary"
							type="submit"
						>
							{ __( 'Save', 'first-admin' ) }
						</Button>
					</HStack>
				</VStack>
			</form>
		</Modal>
	);
}

export default RenameFontSizeDialog;
