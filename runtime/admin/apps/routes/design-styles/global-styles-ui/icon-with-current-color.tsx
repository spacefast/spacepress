import clsx from 'clsx';
import { Icon } from '@wordpress/ui';

interface IconWithCurrentColorProps {
	icon: any;
	className?: string;
	size?: number;
	[ key: string ]: any;
}

export function IconWithCurrentColor( {
	className,
	...props
}: IconWithCurrentColorProps ) {
	return (
		<Icon
			className={ clsx(
				className,
				'zero-admin-global-styles-icon-with-current-color'
			) }
			{ ...props }
		/>
	);
}
