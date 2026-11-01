import type { ControlProps } from '../../utils/types';
import type { RadioGroup } from '../primitives';

export type RadioGroupControlProps = Omit<
	React.ComponentProps< typeof RadioGroup >,
	'children'
> &
	ControlProps & {
		items: {
			label: string;
			value: string;
			description?: string;
			disabled?: boolean;
		}[];
	};
