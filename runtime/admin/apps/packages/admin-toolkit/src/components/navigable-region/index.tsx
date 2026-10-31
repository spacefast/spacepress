import { forwardRef } from 'react';
import clsx from 'clsx';

/**
 * Type definitions
 */
type NavigableRegionProps = {
	children: React.ReactNode;
	className?: string;
	ariaLabel: string;
	as?: React.ElementType;
	[ key: string ]: any;
};

// This is a copy of the private `NavigableRegion` component from the '@wordpress/editor' private APIs.
const NavigableRegion = forwardRef< HTMLElement, NavigableRegionProps >(
	( { children, className, ariaLabel, as: Tag = 'div', ...props }, ref ) => {
		return (
			<Tag
				ref={ ref }
				className={ clsx( 'interface-navigable-region', className ) }
				aria-label={ ariaLabel }
				role="region"
				tabIndex="-1"
				{ ...props }
			>
				{ children }
			</Tag>
		);
	}
);

NavigableRegion.displayName = 'NavigableRegion';

export default NavigableRegion;
