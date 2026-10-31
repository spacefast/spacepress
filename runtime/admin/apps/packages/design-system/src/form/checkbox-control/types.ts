import type { Checkbox as _Checkbox } from '@base-ui/react/checkbox';
import type { ControlProps, ComponentProps } from '../../utils/types';
import type { Checkbox } from '../primitives';

export type CheckboxControlProps = ComponentProps< typeof Checkbox > &
	ControlProps;
