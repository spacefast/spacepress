import { useEffect, useState } from 'react';
import { privateApis as routePrivateApis } from '@wordpress/route';
import { unlock } from '@typedpress-admin/admin-toolkit';
import { useSelect } from '@wordpress/data';
import { store as tpAdminStore } from '../../store';
import {
	findDrilldownParent,
	findDropdownParent,
	findClosestMenuItem,
	findSubmenuParent,
} from './path-matching';
import type { FlatMenuItem } from '../../store/types';

const { useMatches } = unlock( routePrivateApis );

const getParentId = (
	currentMenuItem: FlatMenuItem | null,
	menuItems: FlatMenuItem[]
) => {
	if ( ! currentMenuItem ) {
		return undefined;
	}

	if ( currentMenuItem.parent_type === 'drilldown' ) {
		return findDrilldownParent( currentMenuItem?.id, menuItems );
	}

	return findSubmenuParent( currentMenuItem?.id, menuItems );
};

/**
 * The `useSidebarParent` hook returns the ID of the parent menu item
 * to render in the sidebar based on the current route.
 *
 * - It finds the closest matching menu item when exact path matches fail
 * - It allows the user to navigate in the sidebar (local state) without changing the URL.
 * - If the URL changes, it will update the parent ID to ensure the correct drilldown level is displayed.
 *
 * @return The ID of the parent menu item to render in the sidebar.
 */
export function useSidebarParent() {
	const matches = useMatches();
	const menuItems = useSelect(
		( select ) => select( tpAdminStore ).getMenuItems(),
		[]
	);

	const matchPath = matches[ matches.length - 1 ]?.pathname ?? '';

	const currentMenuItem = findClosestMenuItem( matchPath, menuItems );
	const [ parentId, setParentId ] = useState< string | undefined >(
		getParentId( currentMenuItem, menuItems )
	);

	const [ parentDropdownId, setParentDropdownId ] = useState<
		string | undefined
	>( findDropdownParent( currentMenuItem?.id, menuItems ) );

	// Effect to update parent IDs when URL or menu items change
	useEffect( () => {
		const matchedMenuItem = findClosestMenuItem( matchPath, menuItems );
		// Find the appropriate parents for the current route
		const updatedParentId = getParentId( matchedMenuItem, menuItems );
		const updatedDropdownParent = findDropdownParent(
			matchedMenuItem?.id,
			menuItems
		);

		setParentId( updatedParentId );
		setParentDropdownId( updatedDropdownParent );
	}, [ matchPath, menuItems ] );

	return [
		parentId,
		setParentId,
		parentDropdownId,
		setParentDropdownId,
	] as const;
}
