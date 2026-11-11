import { Link, useNavigate } from '@wordpress/route';
import React, { useState } from 'react';
import { IconButton } from '@wordpress/ui';
import { unlock } from '@first-admin/admin-toolkit';
import { useSelect } from '@wordpress/data';
import { __, sprintf } from '@wordpress/i18n';
import { privateApis as componentsPrivateApis } from '@wordpress/components';
import { store as firstAdminStore } from '../../store';
import type { MenuItem } from '../../store/types';

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const { Menu } = unlock( componentsPrivateApis );

/**
 * Determines whether a menu item is an external link.
 * @param item The menu item to check.
 * @return     True if the item is an external link.
 */
function isItemExternalLink( item: MenuItem ) {
	return (
		! item.callback &&
		item.to &&
		! item.to.startsWith( '/' ) &&
		item.to.includes( '://' )
	);
}

/**
 * Handles click events for menu items
 * @param item     The menu item to create a click handler for
 * @param navigate The navigate function to use for navigation
 */
function createClickHandler(
	item: MenuItem,
	navigate?: ReturnType< typeof useNavigate >
) {
	return ( event: React.MouseEvent ) => {
		if ( item.callback ) {
			return item.callback( event );
		}

		// If `navigate` was passed, it means we should do the `item.to` navigation imperatively.
		// If it wasn't passed, it means that the navigation is already handled by a `Link`/`a` component.
		if ( item.to && navigate ) {
			if ( ! isItemExternalLink( item ) ) {
				return navigate( { to: item.to } );
			}
			window.open( item.to, '_blank', 'noreferrer' );
		}
	};
}

/**
 * Creates a render callback for a menu item that renders links correctly.
 * @param item The menu item.
 */
function createRenderCallback( item: MenuItem ) {
	if ( item.callback || ! item.to ) {
		return undefined;
	}

	return isItemExternalLink( item ) ? (
		// eslint-disable-next-line jsx-a11y/anchor-has-content
		<a href={ item.to } target="_blank" rel="noreferrer" />
	) : (
		<Link to={ item.to } />
	);
}

/**
 * Renders a regular menu item
 * @param item     - The menu item to render
 * @param navigate - The navigate function to use for navigation
 */
function renderMenuItem(
	item: MenuItem,
	navigate: ReturnType< typeof useNavigate >
): JSX.Element {
	return (
		<Menu.Item
			key={ item.id }
			className="first-admin-site-hub_help-menu-item"
			onClick={ createClickHandler( item, navigate ) }
		>
			{ item.label ? (
				<Menu.ItemLabel key={ `item-label-${ item.id }` }>
					{ item.label }
				</Menu.ItemLabel>
			) : null }
		</Menu.Item>
	);
}

/**
 * Renders a menu group with separator
 * @param item     - The menu item with group children to render
 * @param navigate
 */
function renderMenuGroup(
	item: MenuItem,
	navigate: ReturnType< typeof useNavigate >
): JSX.Element | null {
	if ( ! item.children ) {
		return null;
	}
	return (
		<React.Fragment key={ `group-${ item.id }` }>
			<Menu.Separator />
			<Menu.Group>
				{ item.label && (
					<Menu.GroupLabel>{ item.label }</Menu.GroupLabel>
				) }
				{ renderMenuItems( item.children, navigate ) }
			</Menu.Group>
		</React.Fragment>
	);
}

/**
 * Renders a submenu with trigger
 * @param item     - The menu item with submenu children to render
 * @param navigate
 */
function renderSubmenu(
	item: MenuItem,
	navigate: ReturnType< typeof useNavigate >
): JSX.Element | null {
	if ( ! item.children ) {
		return null;
	}
	return (
		<Menu key={ `submenu-${ item.id }` }>
			<Menu.SubmenuTriggerItem className="first-admin-site-hub_help-menu-item">
				<Menu.ItemLabel>{ item.label }</Menu.ItemLabel>
			</Menu.SubmenuTriggerItem>
			<Menu.Popover>
				{ renderMenuItems( item.children, navigate ) }
			</Menu.Popover>
		</Menu>
	);
}

/**
 * Recursively renders menu items and their children
 * @param items    - The menu items to render
 * @param navigate
 */
function renderMenuItems(
	items: MenuItem[],
	navigate: ReturnType< typeof useNavigate >
): ( JSX.Element | null )[] {
	if ( ! items || items.length === 0 ) {
		return [];
	}

	return items.map( ( item ) => {
		const hasChildren = item.children && item.children.length > 0;

		if ( hasChildren ) {
			return item.parent_type === 'dropdown'
				? renderMenuGroup( item, navigate )
				: renderSubmenu( item, navigate );
		}

		return renderMenuItem( item, navigate );
	} );
}

/**
 * Renders a single item as a button instead of a menu with one item.
 * @param props      - The props for the single item button
 * @param props.icon - The icon to display in the button
 * @param props.item - The menu item to render as a single button
 * @return     The rendered single item button
 */
function SingleItemButton( {
	icon,
	item,
}: {
	icon: React.ReactElement;
	item: MenuItem;
} ): JSX.Element {
	const [ isLoading, setIsLoading ] = useState( false );
	const handler = createClickHandler( item );

	const handleClick = ( event: React.MouseEvent ) => {
		const returnValue = handler?.( event );
		if ( returnValue instanceof Promise ) {
			setIsLoading( true );
			return returnValue.finally( () => {
				setIsLoading( false );
			} );
		}
		setIsLoading( false );
	};

	return (
		<IconButton
			size="compact"
			variant="minimal"
			tone="neutral"
			loading={ isLoading }
			disabled={ isLoading }
			loadingAnnouncement={ sprintf(
				/* translators: %s: The label of the menu item */
				__( 'Loading %s…', 'first-admin' ),
				item.label
			) }
			icon={ icon }
			label={ item.label || '' }
			onClick={ handleClick }
			render={ createRenderCallback( item ) }
		/>
	);
}

export function MetaMenu( {
	parent,
	icon,
	label,
}: {
	parent: string;
	icon: React.ReactElement;
	label: string;
} ) {
	const menuItems = useSelect(
		( select ) => select( firstAdminStore ).getMetaMenuItems( parent ),
		[ parent ]
	);
	const itemCount = menuItems.length;
	const navigate = useNavigate();

	if ( itemCount === 0 ) {
		return null;
	}

	// If there's only one item and it has no children, render as single button
	if (
		itemCount === 1 &&
		( ! menuItems[ 0 ].children || menuItems[ 0 ].children.length === 0 )
	) {
		return <SingleItemButton icon={ icon } item={ menuItems[ 0 ] } />;
	}

	return (
		<Menu>
			<Menu.TriggerButton
				render={
					<IconButton
						size="compact"
						variant="minimal"
						tone="neutral"
						icon={ icon }
						label={ label }
					/>
				}
			/>
			<Menu.Popover className="first-admin-site-hub_help-menu">
				{ renderMenuItems( menuItems, navigate ) }
			</Menu.Popover>
		</Menu>
	);
}

export default MetaMenu;
