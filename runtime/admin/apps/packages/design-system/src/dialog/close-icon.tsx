import { forwardRef } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { close } from '@wordpress/icons';
import { __ } from '@wordpress/i18n';
import { IconButton } from '@wordpress/ui';
import { type CloseIconProps } from './types';

const CloseIcon = forwardRef< HTMLButtonElement, CloseIconProps >(
	function DialogCloseIcon( props, ref ) {
		return (
			<Dialog.Close
				ref={ ref }
				render={
					<IconButton
						variant="minimal"
						size="compact"
						tone="neutral"
						{ ...props }
						icon={ close }
						label={ __( 'Close', 'wpds' ) }
					/>
				}
			/>
		);
	}
);

export { CloseIcon };
