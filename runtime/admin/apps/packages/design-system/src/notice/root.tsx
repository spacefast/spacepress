import { speak } from '@wordpress/a11y';
import { renderToString } from '@wordpress/element';
import { info, published, error, caution } from '@wordpress/icons';
import { useEffect, forwardRef } from 'react';
import { useRender, mergeProps } from '@base-ui/react';
import clsx from 'clsx';
import { Icon } from '@wordpress/ui';
import type { ComponentProps } from 'react';
import resetStyles from '../utils/css/resets.module.css';
import type { NoticeIntent, RootProps } from './types';
import styles from './style.module.css';

const icons: {
	[ key in NoticeIntent ]: ComponentProps< typeof Icon >[ 'icon' ] | null;
} = {
	neutral: null,
	info,
	warning: caution,
	success: published,
	error,
};

/**
 * Returns the default politeness level based on the notice intent.
 * Error uses 'assertive' for urgent announcements, others use 'polite'.
 */
function getDefaultPoliteness( intent: NoticeIntent ): 'polite' | 'assertive' {
	return intent === 'error' ? 'assertive' : 'polite';
}

/**
 * Safely converts a message to a string for screen reader announcement.
 * Returns undefined if the message can't be safely serialized.
 */
function safeRenderToString( message: RootProps[ 'spokenMessage' ] ) {
	if ( ! message ) {
		return undefined;
	}
	if ( typeof message === 'string' ) {
		return message;
	}
	try {
		return renderToString( message );
	} catch {
		// If renderToString fails (e.g., due to complex components like Tooltip),
		// return undefined and skip the announcement
		return undefined;
	}
}

/**
 * Custom hook which announces the message with the given politeness.
 */
function useSpokenMessage(
	message: RootProps[ 'spokenMessage' ],
	politeness: 'polite' | 'assertive'
) {
	const spokenMessage = safeRenderToString( message );

	useEffect( () => {
		if ( spokenMessage ) {
			speak( spokenMessage, politeness );
		}
	}, [ spokenMessage, politeness ] );
}

/**
 * The Notice component is a visually non-obtrusive element that communicates the system status
 * and provides options and actions related to the message tone.
 *
 * ```jsx
 * import { Notice } from '@spacepress-admin/design-system';
 *
 * function MyComponent() {
 * 	return (
 * 		<Notice.Root intent="info">
 * 			<Notice.Title>Heading</Notice.Title>
 * 			<Notice.Description>Body text</Notice.Description>
 * 			<Notice.Actions>
 * 				<Notice.ActionButton>Action</Notice.ActionButton>
 * 			</Notice.Actions>
 * 			<Notice.CloseIcon onClick={() => {}} />
 * 		</Notice.Root>
 * 	);
 * }
 * ```
 */
export const Root = forwardRef< HTMLDivElement, RootProps >( function Notice(
	{
		intent = 'neutral',
		children,
		icon,
		spokenMessage = children,
		politeness = getDefaultPoliteness( intent ),
		render,
		...restProps
	},
	ref
) {
	// Announce to screen readers via speak() API - no role attribute needed
	// as it would cause double announcements
	useSpokenMessage( spokenMessage, politeness );

	const iconElement = icon === null ? null : icon ?? icons[ intent ];

	const mergedClassName = clsx(
		styles.notice,
		styles[ `is-${ intent }` ],
		resetStyles[ 'box-sizing' ]
	);

	const element = useRender( {
		defaultTagName: 'div',
		render,
		ref,
		props: mergeProps< 'div' >(
			{
				className: mergedClassName,
				children: (
					<>
						{ children }
						{ iconElement && (
							<Icon
								className={ styles.icon }
								icon={ iconElement }
							/>
						) }
					</>
				),
			},
			restProps
		),
	} );

	return element;
} );
