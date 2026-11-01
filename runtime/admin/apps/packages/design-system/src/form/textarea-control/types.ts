import type { Textarea } from '../primitives';
import type { ControlProps } from '../../utils/types';

export type TextareaControlProps = React.ComponentProps< typeof Textarea > &
	ControlProps;
