import { forwardRef } from 'react';
import { Autocomplete } from '../primitives';
import type { AutocompleteItemProps } from '../primitives/autocomplete/types';

export const Item = forwardRef< HTMLDivElement, AutocompleteItemProps >(
	function Item( props, ref ) {
		return <Autocomplete.Item ref={ ref } { ...props } />;
	}
);
