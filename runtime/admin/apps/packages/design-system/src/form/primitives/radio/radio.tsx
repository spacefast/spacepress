import { forwardRef } from 'react';
import clsx from 'clsx';
import { Radio as _Radio } from '@base-ui/react/radio';
import type { RadioProps } from './types';
import resetStyles from '../../../utils/css/resets.module.css';
import focusStyles from '../../../utils/css/focus.module.css';
import styles from './style.module.css';

/**
 * A radio button primitive.
 *
 * Cannot be used standalone — must be used within a `RadioGroup` component.
 */
export const Radio = forwardRef< HTMLSpanElement, RadioProps >( function Radio(
	{ className, ...restProps },
	ref
) {
	return (
		<_Radio.Root
			ref={ ref }
			className={ clsx(
				resetStyles[ 'box-sizing' ],
				focusStyles[ 'outset-ring--focus' ],
				styles.root,
				className
			) }
			{ ...restProps }
		>
			<_Radio.Indicator className={ styles.indicator } keepMounted />
		</_Radio.Root>
	);
} );
