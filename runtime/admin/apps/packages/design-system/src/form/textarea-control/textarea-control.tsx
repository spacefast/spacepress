import { forwardRef } from 'react';
import { Textarea, Field } from '../primitives';
import type { TextareaControlProps } from './types';

/**
 * A complete textarea field with integrated label and description.
 * Built on form primitives with design token styling.
 */
export const TextareaControl = forwardRef<
	HTMLTextAreaElement,
	TextareaControlProps
>( function TextareaControl(
	{ className, label, description, ...restProps },
	ref
) {
	return (
		<Field.Root className={ className }>
			<Field.Label>{ label }</Field.Label>
			<Textarea ref={ ref } { ...restProps } />
			{ description && (
				<Field.Description>{ description }</Field.Description>
			) }
		</Field.Root>
	);
} );
