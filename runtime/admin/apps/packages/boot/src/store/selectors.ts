import { createSelector } from '@wordpress/data';
import type { State } from './reducer';
import type { MenuItem } from './types';
import { buildMenuTree } from '../utils/menu-tree';

export function getRoutes( state: State ): State[ 'routes' ] {
	return state.routes;
}

export function getMenuItems( state: State ): State[ 'menuItems' ] {
	return state.menuItems;
}

export function getDashboardWidgetTypes(
	state: State
): State[ 'dashboardWidgetTypes' ] {
	return state.dashboardWidgetTypes;
}

export function getDashboardContext(
	state: State
): State[ 'dashboardContext' ] {
	return state.dashboardContext;
}

export function getDashboardDefaultLayout(
	state: State
): State[ 'dashboardDefaultLayout' ] {
	return state.dashboardDefaultLayout;
}

export function getNudges( state: State ): State[ 'nudges' ] {
	return state.nudges;
}

/**
 * Get the current nudge to display (returns first item, priority-sorted by backend).
 *
 * @param {State} state - The store state.
 * @return {Object|null} The current nudge or null.
 */
export function getCurrentNudge( state: State ) {
	const nudges = state.nudges;
	return nudges?.[ 0 ] ?? null;
}

/**
 * Get a nudge by type.
 *
 * @param {State}  state - The store state.
 * @param {string} type  - The nudge type to find.
 * @return {Object|null} The matching nudge or null.
 */
export function getNudgeByType( state: State, type: string ) {
	const nudges = state.nudges;
	return nudges?.find( ( nudge ) => nudge.type === type ) ?? null;
}

const EMPTY_ARRAY: MenuItem[] = [];

export const getMetaMenuItems = createSelector(
	( state: State, parent: string ): MenuItem[] => {
		// We only support wp-logo menu for now.
		const menuTree = buildMenuTree( state.metaMenuItems );
		const wpLogoMenu = menuTree.find( ( { id } ) => id === parent );
		return wpLogoMenu?.children ?? EMPTY_ARRAY;
	},
	( state: State ) => [ state.metaMenuItems ]
);

export function getSettingsRoute( state: State ): string | undefined {
	const settingsItem = state.metaMenuItems.find(
		( item ) => item.id === 'settings'
	);

	return settingsItem?.to;
}

export function getDashboardNotices(
	state: State
): State[ 'dashboardNotices' ] {
	return state.dashboardNotices;
}

export function getModals( state: State ): State[ 'modals' ] {
	return state.modals;
}
