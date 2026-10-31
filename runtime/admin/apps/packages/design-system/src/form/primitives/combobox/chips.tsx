import { Combobox as _Combobox } from '@base-ui/react/combobox';
import { forwardRef } from 'react';
import type { ComboboxChipsProps } from './types';

export const Chips = forwardRef< HTMLDivElement, ComboboxChipsProps >(
	function Chips( props, ref ) {
		return <_Combobox.Chips ref={ ref } { ...props } />;
	}
);
