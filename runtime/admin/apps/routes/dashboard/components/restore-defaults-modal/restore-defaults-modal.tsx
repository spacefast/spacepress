import { Button } from '@wordpress/ui';
import { Dialog } from '@zero-admin/design-system';
import { __ } from '@wordpress/i18n';

interface RestoreDefaultsModalProps {
	isOpen: boolean;
	onClose: () => void;
	onConfirm: () => void;
}

export function RestoreDefaultsModal( {
	isOpen,
	onClose,
	onConfirm,
}: RestoreDefaultsModalProps ) {
	return (
		<Dialog.Root
			open={ isOpen }
			title={ __( 'Restore default widgets?', 'zero-admin' ) }
		>
			<Dialog.Popup>
				<Dialog.Header>
					<Dialog.Heading />
				</Dialog.Header>

				<p>
					{ __(
						'All widgets will be reset to their default configuration. Any custom changes will be removed.',
						'zero-admin'
					) }
				</p>

				<Dialog.Footer>
					<Button variant="minimal" onClick={ onClose }>
						{ __( 'Cancel', 'zero-admin' ) }
					</Button>

					<Dialog.Action onClick={ onConfirm }>
						{ __( 'Restore defaults', 'zero-admin' ) }
					</Dialog.Action>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
