// Import required for TS to locate the underlying types
import type { Select as _Select } from '@base-ui/react/select';
import { forwardRef } from 'react';
import { Select } from '../primitives';
import { useSelectControlSizeContext } from './context';
import type { SelectItemProps } from '../primitives/select/types';

export const Item = forwardRef< HTMLDivElement, SelectItemProps >(
	function Item( { size: sizeProp, ...restProps }, ref ) {
		const contextSize = useSelectControlSizeContext();
		const size = sizeProp ?? contextSize;

		return <Select.Item size={ size } ref={ ref } { ...restProps } />;
	}
);
