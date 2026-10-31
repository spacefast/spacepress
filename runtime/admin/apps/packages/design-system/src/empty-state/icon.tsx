import { forwardRef } from 'react';
import clsx from 'clsx';
import { Icon as _Icon } from '@wordpress/ui';
import { Visual } from './visual';
import type { EmptyStateIconProps } from './types';
import styles from './style.module.css';

/**
 * An icon visual for empty states. Renders an icon with styling treatment for
 * empty states.
 */
export const Icon = forwardRef< HTMLDivElement, EmptyStateIconProps >(
	function EmptyStateIcon( { icon, className, ...restProps }, ref ) {
		return (
			<Visual
				ref={ ref }
				className={ clsx( styles.icon, className ) }
				{ ...restProps }
			>
				<_Icon icon={ icon } />
			</Visual>
		);
	}
);
