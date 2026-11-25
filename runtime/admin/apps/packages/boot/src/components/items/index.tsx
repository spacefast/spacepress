import { isValidElement } from 'react';
import { Icon } from '@wordpress/ui';
import { Dashicon } from '@wordpress/components';
import { page } from '@wordpress/icons';
import { SVG } from '@wordpress/primitives';
import { resolveNamedIcon } from '../../icons';
import type { IconType } from '../../store/types';

type DesignSystemIcon = React.ComponentProps< typeof Icon >[ 'icon' ];

/**
 * Type guard for verifying whether a given element
 * is a valid SVG element for the `Icon` @spacepress-admin/design-system component.
 * @param element
 */
function isSvg( element: unknown ): element is DesignSystemIcon {
	return (
		isValidElement( element ) &&
		( element.type === SVG || element.type === 'svg' )
	);
}

/**
 * Converts the given IconType into:
 * - a named SpacePress or Dashicon string into a Design System SVG Icon (or Dashicon fallback),
 * - a data URL into an `<img>`,
 * - a JSX SVG element into a Design System Icon component.
 *
 * @param icon                  The icon to convert.
 * @param shouldShowPlaceholder Whether to show placeholder when no icon is provided.
 * @return The converted icon as a JSX element.
 */
export function wrapIcon(
	icon?: IconType,
	shouldShowPlaceholder: boolean = true
) {
	if ( isSvg( icon ) ) {
		return <Icon icon={ icon } />;
	}

	if ( typeof icon === 'string' ) {
		// Handle data URLs (SVG images)
		if ( icon.startsWith( 'data:' ) ) {
			return (
				<img
					src={ icon }
					alt=""
					aria-hidden="true"
					style={ {
						width: '20px',
						height: '20px',
						display: 'block',
						padding: '2px',
					} }
				/>
			);
		}

		const resolved = resolveNamedIcon( icon );
		if ( isSvg( resolved ) ) {
			return <Icon icon={ resolved } />;
		}

		if ( icon.startsWith( 'dashicons-' ) ) {
			const iconKey = icon.replace(
				/^dashicons-/,
				''
			) as React.ComponentProps< typeof Dashicon >[ 'icon' ];

			return (
				<Dashicon
					style={ { padding: '2px' } }
					icon={ iconKey }
					aria-hidden="true"
				/>
			);
		}

		if ( icon.trim().length > 0 ) {
			return <Icon icon={ page } />;
		}
	}

	// If icon is provided and valid, return it as-is
	if ( icon ) {
		return icon;
	}

	// Return empty 24px placeholder for alignment when no icon is provided
	// Only if shouldShowPlaceholder is true
	if ( shouldShowPlaceholder ) {
		return (
			<div
				style={ { width: '24px', height: '24px' } }
				aria-hidden="true"
			/>
		);
	}

	return null;
}
