import { forwardRef } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from '@wordpress/ui';
import { type ActionProps } from './types';

const Action = forwardRef< HTMLButtonElement, ActionProps >(
	function DialogAction( { render, ...props }, ref ) {
		return (
			<Dialog.Close
				ref={ ref }
				render={ <Button render={ render } /> }
				{ ...props }
			/>
		);
	}
);

export { Action };
