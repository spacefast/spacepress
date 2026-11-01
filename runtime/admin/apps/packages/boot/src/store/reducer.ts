import { combineReducers } from '@wordpress/data';
import type {
	Route,
	FlatMenuItem,
	Nudge,
	DashboardContext,
	RegisteredModal,
} from './types';

export type State = {
	routes: Route[];
	menuItems: FlatMenuItem[];
	metaMenuItems: FlatMenuItem[];
	dashboardContext: DashboardContext;
	nudges: Nudge[];
	modals: RegisteredModal[];
};

/**
 * Action types
 */
type RouteAction =
	| { type: 'REGISTER_ROUTE'; route: Route }
	| { type: 'UNREGISTER_ROUTE'; path: string };

type MenuItemAction =
	| { type: 'REGISTER_MENU_ITEM'; menuItem: FlatMenuItem }
	| { type: 'UNREGISTER_MENU_ITEM'; id: string }
	| {
			type: 'UPDATE_MENU_ITEM';
			id: string;
			changes: Partial< FlatMenuItem >;
	  };

type MetaMenuItemAction =
	| { type: 'REGISTER_SITE_HUB_HELP_MENU_ITEM'; menuItem: FlatMenuItem }
	| { type: 'UNREGISTER_SITE_HUB_HELP_MENU_ITEM'; id: string };

type NudgeAction = { type: 'SET_NUDGES'; nudges: Nudge[] };

type DashboardContextAction = {
	type: 'SET_DASHBOARD_CONTEXT';
	context: Partial< DashboardContext >;
};

type ModalAction =
	| { type: 'REGISTER_MODAL'; modal: RegisteredModal }
	| { type: 'UNREGISTER_MODAL'; id: string };

type Action =
	| RouteAction
	| MenuItemAction
	| MetaMenuItemAction
	| NudgeAction
	| DashboardContextAction
	| ModalAction;

function routes( state: Route[] = [], action: Action ): Route[] {
	switch ( action.type ) {
		case 'REGISTER_ROUTE':
			return [ ...state, action.route ];
		case 'UNREGISTER_ROUTE':
			return state.filter( ( route ) => route.path !== action.path );
	}
	return state;
}

function menuItems(
	state: FlatMenuItem[] = [],
	action: Action
): FlatMenuItem[] {
	switch ( action.type ) {
		case 'REGISTER_MENU_ITEM':
			return [ ...state, action.menuItem ];
		case 'UNREGISTER_MENU_ITEM':
			return state.filter( ( menuItem ) => menuItem.id !== action.id );
		case 'UPDATE_MENU_ITEM':
			return state.map( ( item ) =>
				item.id === action.id ? { ...item, ...action.changes } : item
			);
	}
	return state;
}

function metaMenuItems(
	state: FlatMenuItem[] = [],
	action: Action
): FlatMenuItem[] {
	switch ( action.type ) {
		case 'REGISTER_SITE_HUB_HELP_MENU_ITEM':
			return [ ...state, action.menuItem ];
		case 'UNREGISTER_SITE_HUB_HELP_MENU_ITEM':
			return state.filter( ( item ) => item.id !== action.id );
	}
	return state;
}

const DEFAULT_DASHBOARD_CONTEXT: DashboardContext = {
	logout_url: '/wp-login.php?action=logout',
};

function dashboardContext(
	state: DashboardContext = DEFAULT_DASHBOARD_CONTEXT,
	action: Action
): DashboardContext {
	switch ( action.type ) {
		case 'SET_DASHBOARD_CONTEXT':
			return { ...DEFAULT_DASHBOARD_CONTEXT, ...action.context };
	}
	return state;
}

function nudges( state: Nudge[] = [], action: Action ): Nudge[] {
	switch ( action.type ) {
		case 'SET_NUDGES':
			return action.nudges;
	}
	return state;
}

function modals(
	state: RegisteredModal[] = [],
	action: Action
): RegisteredModal[] {
	switch ( action.type ) {
		case 'REGISTER_MODAL':
			return [ ...state, action.modal ];
		case 'UNREGISTER_MODAL':
			return state.filter( ( modal ) => modal.id !== action.id );
	}
	return state;
}

export default combineReducers( {
	routes,
	menuItems,
	metaMenuItems,
	dashboardContext,
	nudges,
	modals,
} ) as ( state: State | undefined, action: Action ) => State;
