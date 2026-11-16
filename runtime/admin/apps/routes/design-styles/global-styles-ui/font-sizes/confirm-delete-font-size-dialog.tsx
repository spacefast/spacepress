import type { FontSize } from '@typedpress-admin/global-styles-engine';
import { __experimentalConfirmDialog as ConfirmDialog } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

interface ConfirmDeleteFontSizeDialogProps {
	fontSize: FontSize;
	isOpen: boolean;
	toggleOpen: () => void;
	handleRemoveFontSize: ( fontSize: FontSize ) => void;
}

function ConfirmDeleteFontSizeDialog( {
	fontSize,
	isOpen,
	toggleOpen,
	handleRemoveFontSize,
}: ConfirmDeleteFontSizeDialogProps ) {
	const handleConfirm = async () => {
		toggleOpen();
		handleRemoveFontSize( fontSize );
	};

	const handleCancel = () => {
		toggleOpen();
	};

	return (
		<ConfirmDialog
			isOpen={ isOpen }
			cancelButtonText={ __( 'Cancel', 'typedpress-admin' ) }
			confirmButtonText={ __( 'Delete', 'typedpress-admin' ) }
			onCancel={ handleCancel }
			onConfirm={ handleConfirm }
			size="medium"
		>
			{ fontSize &&
				sprintf(
					/* translators: %s: Name of the font size preset. */
					__(
						'Are you sure you want to delete "%s" font size preset?',
						'typedpress-admin'
					),
					fontSize.name
				) }
		</ConfirmDialog>
	);
}

export default ConfirmDeleteFontSizeDialog;
