import { forwardRef } from 'react';
import clsx from 'clsx';
import { __ } from '@wordpress/i18n';
import { useRender, mergeProps } from '@base-ui/react';
import { type LinkProps } from './types';
import styles from './style.module.css';

export const Link = forwardRef< HTMLAnchorElement, LinkProps >( function Link(
	{
		render,
		tone = 'brand',
		openInNewTab = false,
		children,
		rel = '',
		onClick,
		target,
		...restProps
	},
	ref
) {
	const isInternalAnchor = !! restProps.href?.startsWith( '#' );

	const relParts = [
		...rel.split( ' ' ),
		...( openInNewTab ? [ 'noreferrer', 'noopener' ] : [] ),
	];
	const mergedRel =
		relParts.filter( Boolean ).length > 0
			? [ ...new Set( relParts.filter( Boolean ) ) ].join( ' ' )
			: undefined;

	const handleClick = ( event: React.MouseEvent< HTMLAnchorElement > ) => {
		if ( openInNewTab && isInternalAnchor ) {
			event.preventDefault();
		}
		onClick?.( event );
	};

	const element = useRender( {
		defaultTagName: 'a',
		render,
		ref,
		props: mergeProps< 'a' >(
			{
				className: clsx(
					styles.link,
					styles[ `is-${ tone }` ],
					openInNewTab && styles[ 'has-link-icon' ]
				),
				rel: mergedRel,
				onClick: handleClick,
				target: openInNewTab ? '_blank' : target,
				children: openInNewTab ? (
					<>
						<span className={ styles[ 'link-contents' ] }>
							{ children }
						</span>
						<span
							className={ styles[ 'link-icon' ] }
							aria-label={
								/* translators: accessibility text appended to link text */
								__( '(opens in a new tab)', 'wpds' )
							}
						/>
					</>
				) : (
					children
				),
			},
			restProps
		),
	} );

	return element;
} );
