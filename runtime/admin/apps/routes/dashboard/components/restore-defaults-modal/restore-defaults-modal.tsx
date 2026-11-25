import { Button } from '@wordpress/ui';
import { Dialog } from '@spacepress-admin/design-system';
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
			title={ __( 'Restore default widgets?', 'spacepress-admin' ) }
		>
			<Dialog.Popup>
				<Dialog.Header>
					<Dialog.Heading />
				</Dialog.Header>

				<p>
					{ __(
						'All widgets will be reset to their default configuration. Any custom changes will be removed.',
						'spacepress-admin'
					) }
				</p>

				<Dialog.Footer>
					<Button variant="minimal" onClick={ onClose }>
						{ __( 'Cancel', 'spacepress-admin' ) }
					</Button>

					<Dialog.Action onClick={ onConfirm }>
						{ __( 'Restore defaults', 'spacepress-admin' ) }
					</Dialog.Action>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
