import clsx from 'clsx';
import { forwardRef } from 'react';
import { Stack } from '../../../stack';
import styles from './style.module.css';

/**
 * A convenience styling wrapper for nested checkbox items.
 */
export const NestedItems = forwardRef<
	HTMLDivElement,
	React.ComponentProps< typeof Stack >
>( function NestedItems( { className, ...restProps }, ref ) {
	return (
		<Stack
			direction="column"
			gap={ 2 }
			ref={ ref }
			className={ clsx( styles[ 'nested-items' ], className ) }
			{ ...restProps }
		/>
	);
} );
