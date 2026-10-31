import { RadioGroup as _RadioGroup } from '@base-ui/react/radio-group';
import { forwardRef } from 'react';
import type { RadioGroupProps } from './types';

export const RadioGroup = forwardRef< HTMLDivElement, RadioGroupProps >(
	function RadioGroup( props, ref ) {
		return <_RadioGroup ref={ ref } { ...props } />;
	}
);
