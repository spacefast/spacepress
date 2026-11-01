import { forwardRef } from 'react';
// Import required for TS to locate the underlying types
import type { Combobox as _Combobox } from '@base-ui/react/combobox';
import { Field, SearchableChipSelect } from '../primitives';
import type { SearchableChipSelectControlProps } from './types';

/**
 * A searchable multi-selection component with chips, with support for
 * a footer item to create new items.
 */
export const SearchableChipSelectControl = forwardRef<
	HTMLDivElement,
	SearchableChipSelectControlProps
>( function SearchableChipSelectControl(
	{ className, label, description, ...restProps },
	ref
) {
	return (
		<Field.Root className={ className }>
			<Field.Label>{ label }</Field.Label>
			<Field.Control
				render={ <SearchableChipSelect ref={ ref } { ...restProps } /> }
			/>
			{ description && (
				<Field.Description>{ description }</Field.Description>
			) }
		</Field.Root>
	);
} );
