import clsx from 'clsx';
import { Flex } from '@wordpress/components';

interface ColorIndicatorWrapperProps {
	className?: string;
	[ key: string ]: any;
}

function ColorIndicatorWrapper( {
	className,
	children,
	...props
}: ColorIndicatorWrapperProps ) {
	return (
		<Flex
			className={ clsx(
				'first-admin-global-styles__color-indicator-wrapper',
				className
			) }
			{ ...props }
		>
			{ children }
		</Flex>
	);
}

export default ColorIndicatorWrapper;
