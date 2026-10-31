import { Switch as _Switch } from '@base-ui/react/switch';
import clsx from 'clsx';
import { forwardRef } from 'react';
import resetStyles from '../../../utils/css/resets.module.css';
import focusStyles from '../../../utils/css/focus.module.css';
import type { SwitchProps } from './types';
import styles from './style.module.css';

export const Switch = forwardRef< HTMLSpanElement, SwitchProps >(
	function Switch( { className, ...restProps }, ref ) {
		return (
			<_Switch.Root
				ref={ ref }
				className={ clsx(
					resetStyles[ 'box-sizing' ],
					focusStyles[ 'outset-ring--focus' ],
					styles.root,
					className
				) }
				{ ...restProps }
			>
				<_Switch.Thumb className={ styles.thumb } />
			</_Switch.Root>
		);
	}
);
