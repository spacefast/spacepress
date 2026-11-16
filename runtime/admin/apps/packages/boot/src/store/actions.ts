import type {
	DashboardWidget,
	RegisteredDashboardWidgetType,
} from '@typedpress-admin/dashboard';
import type {
	Route,
	FlatMenuItem,
	Nudge,
	DashboardNoticeConfig,
	DashboardContext,
	RegisteredModal,
} from './types';

export function registerRoute( route: Route ) {
	return {
		type: 'REGISTER_ROUTE',
		route,
	};
}

export function unregisterRoute( path: string ) {
	return {
		type: 'UNREGISTER_ROUTE',
		path,
	};
}

export function registerMenuItem(
	id: string,
	args: Omit< FlatMenuItem, 'id' >
) {
	return {
		type: 'REGISTER_MENU_ITEM',
		menuItem: { id, ...args },
	};
}

export function registerSiteHubHelpMenuItem(
	id: string,
	args: Omit< FlatMenuItem, 'id' >
) {
	return {
		type: 'REGISTER_SITE_HUB_HELP_MENU_ITEM',
		menuItem: { id, ...args },
	};
}

export function unregisterSiteHubHelpMenuItem( id: string ) {
	return {
		type: 'UNREGISTER_SITE_HUB_HELP_MENU_ITEM',
		id,
	};
}

export function unregisterMenuItem( id: string ) {
	return {
		type: 'UNREGISTER_MENU_ITEM',
		id,
	};
}

export function updateMenuItem( id: string, changes: Partial< FlatMenuItem > ) {
	return {
		type: 'UPDATE_MENU_ITEM',
		id,
		changes,
	};
}

export function setDashboardWidgetTypes(
	widgets: RegisteredDashboardWidgetType[]
) {
	return {
		type: 'SET_DASHBOARD_WIDGET_TYPES' as const,
		widgets,
	};
}

export function setDashboardContext( context: Partial< DashboardContext > ) {
	return {
		type: 'SET_DASHBOARD_CONTEXT' as const,
		context,
	};
}

export function setNudges( nudges: Nudge[] ) {
	return {
		type: 'SET_NUDGES' as const,
		nudges,
	};
}

export function registerDashboardNotice( notice: DashboardNoticeConfig ) {
	return {
		type: 'REGISTER_DASHBOARD_NOTICE' as const,
		notice,
	};
}

export function unregisterDashboardNotice( id: string ) {
	return {
		type: 'UNREGISTER_DASHBOARD_NOTICE' as const,
		id,
	};
}

export function updateDashboardNotice(
	id: string,
	changes: Partial< DashboardNoticeConfig >
) {
	return {
		type: 'UPDATE_DASHBOARD_NOTICE' as const,
		id,
		changes,
	};
}

export function setDashboardDefaultLayout(
	widgets: DashboardWidget< unknown >[]
) {
	return {
		type: 'SET_DASHBOARD_DEFAULT_LAYOUT' as const,
		widgets,
	};
}

export function registerModal( modal: RegisteredModal ) {
	return {
		type: 'REGISTER_MODAL' as const,
		modal,
	};
}

export function unregisterModal( id: string ) {
	return {
		type: 'UNREGISTER_MODAL' as const,
		id,
	};
}
