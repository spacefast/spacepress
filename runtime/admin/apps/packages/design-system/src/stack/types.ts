import { type CSSProperties, type ReactNode } from 'react';
import { type ComponentProps } from '../utils/types';

export interface StackProps extends ComponentProps< 'div' > {
	/**
	 * The direction of the stack.
	 */
	direction?: Exclude<
		CSSProperties[ 'flexDirection' ],
		'row-reverse' | 'column-reverse'
	>;

	/**
	 * The amount of space between each child element. As a number, it is a
	 * multiple of the design system grid spacing.
	 *
	 * @default 'initial'
	 */
	gap?: number | CSSProperties[ 'gap' ];

	/**
	 * The alignment of the stack items along the cross axis.
	 *
	 * @default 'initial'
	 */
	align?: CSSProperties[ 'alignItems' ];

	/**
	 * The alignment of the stack items along the main axis.
	 *
	 * @default 'initial'
	 */
	justify?: CSSProperties[ 'justifyContent' ];

	/**
	 * Whether the stack items should wrap to the next line.
	 */
	wrap?: Exclude< CSSProperties[ 'flexWrap' ], 'wrap-reverse' >;

	/**
	 * The content to be rendered inside the component.
	 */
	children?: ReactNode;
}
