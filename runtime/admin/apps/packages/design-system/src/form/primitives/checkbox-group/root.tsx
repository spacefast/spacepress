import { CheckboxGroup as _CheckboxGroup } from '@base-ui/react/checkbox-group';
import { forwardRef } from 'react';
import { Stack } from '../../../stack';
import type { CheckboxGroupProps } from './types';

const DEFAULT_RENDER = ( props: React.ComponentProps< typeof Stack > ) => (
	<Stack direction="column" gap={ 2 } { ...props } />
);

export const Root = forwardRef< HTMLDivElement, CheckboxGroupProps >(
	function Root( { render = DEFAULT_RENDER, ...restProps }, ref ) {
		return (
			<_CheckboxGroup ref={ ref } render={ render } { ...restProps } />
		);
	}
);
