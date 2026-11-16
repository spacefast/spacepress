import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Icon } from '@wordpress/ui';
// eslint-disable-next-line @typedpress-admin/design-system/use-new-components
import { Stack } from '@typedpress-admin/design-system';
import { FlexBlock, __experimentalItem as Item } from '@wordpress/components';
import { arrowUpRight } from '@wordpress/icons';
import RouterLinkItem from '../router-link-item';
import { wrapIcon } from '../items';
import MenuBadge from '../sidebar/menu-badge';
import type { IconType } from '../../store/types';
import './style.scss';

interface SidebarNavigationItemProps {
	/**
	 * Optional CSS class name.
	 */
	className?: string;
	/**
	 * Icon to display with the navigation item.
	 */
	icon?: IconType;
	/**
	 * Whether to show placeholder icons for alignment.
	 */
	shouldShowPlaceholder?: boolean;
	/**
	 * Content to display inside the navigation item.
	 */
	children: ReactNode;
	/**
	 * Optional badge content.
	 */
	badge?: string | number | null;
	/**
	 * The path to navigate to.
	 */
	to: string;
}

export default function SidebarNavigationItem( {
	className,
	icon,
	shouldShowPlaceholder = true,
	children,
	badge,
	to,
}: SidebarNavigationItemProps ) {
	// In the Content frame (about:srcdoc), location.origin is "null".
	const isExternal = new URL( to, window.origin ).origin !== window.origin;
	// Absolute URLs point outside the SPA, including WordPress's own admin_url().
	const isDocumentNavigation =
		isExternal || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test( to );

	const content = (
		<Stack
			direction="row"
			justify="flex-start"
			gap={ 2 }
			align="center"
			style={ { flexGrow: '1' } }
		>
			{ wrapIcon( icon, shouldShowPlaceholder ) }
			<FlexBlock>{ children }</FlexBlock>
			<MenuBadge badge={ badge } />
		</Stack>
	);

	if ( isDocumentNavigation ) {
		return (
			<Item
				as="a"
				href={ to }
				target={ isExternal ? '_blank' : undefined }
				rel={ isExternal ? 'noopener noreferrer' : undefined }
				className={ clsx(
					'typedpress-admin-sidebar-navigation-item',
					className
				) }
			>
				{ content }
				{ isExternal && <Icon icon={ arrowUpRight } size={ 20 } /> }
			</Item>
		);
	}

	return (
		<RouterLinkItem
			to={ to }
			className={ clsx(
				'typedpress-admin-sidebar-navigation-item',
				className
			) }
		>
			{ content }
		</RouterLinkItem>
	);
}
