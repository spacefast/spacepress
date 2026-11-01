import { forwardRef } from 'react';
// Import required for TS to locate the underlying types
import type { Combobox as _Combobox } from '@base-ui/react/combobox';
import { Field, SearchableSelect } from '../primitives';
import type { SearchableSelectControlProps } from './types';

/**
 * A searchable single-selection component, with support for
 * a footer item to create new items.
 */
export const SearchableSelectControl = forwardRef<
	HTMLButtonElement,
	SearchableSelectControlProps
>( function SearchableSelectControl(
	{ className, label, description, ...restProps },
	ref
) {
	return (
		<Field.Root className={ className }>
			<Field.Label>{ label }</Field.Label>
			<Field.Control
				render={ <SearchableSelect ref={ ref } { ...restProps } /> }
			/>
			{ description && (
				<Field.Description>{ description }</Field.Description>
			) }
		</Field.Root>
	);
} );
