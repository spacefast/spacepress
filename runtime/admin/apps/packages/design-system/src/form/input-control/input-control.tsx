import { forwardRef } from 'react';
import { Input, Field } from '../primitives';
import type { InputControlProps } from './types';

/**
 * A complete input field with integrated label and description.
 * Built on form primitives with design token styling.
 */
export const InputControl = forwardRef< HTMLInputElement, InputControlProps >(
	function InputControl(
		{ className, label, description, ...restProps },
		ref
	) {
		return (
			<Field.Root className={ className }>
				<Field.Label>{ label }</Field.Label>
				<Input ref={ ref } { ...restProps } />
				{ description && (
					<Field.Description>{ description }</Field.Description>
				) }
			</Field.Root>
		);
	}
);
