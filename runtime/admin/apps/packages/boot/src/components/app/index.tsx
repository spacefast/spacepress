/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access -- TanStack Router private APIs via unlock() and dynamic imports are untyped */
import { createRoot } from 'react-dom/client';
import { privateApis as routePrivateApis } from '@wordpress/route';
import { useMemo, useEffect, StrictMode } from 'react';
import { unlock } from '@first-admin/admin-toolkit';
import { useSelect, dispatch } from '@wordpress/data';
import '@wordpress/theme';
import { getRouter, loadAdminModule } from './router';
import { configureSite } from '../../site';
import { store as firstAdminStore } from '../../store';
import { updateMenuIcons } from '../../icons';
import { ModalRenderer } from '../modal-renderer';
import type { Route, FlatMenuItem, DashboardContext } from '../../store/types';
import './legacy-components-overrides.scss';
import './popover-compatibility.scss';
import './legacy-wpds-compatibility.scss';
import './legacy-admin-ui-bridge.scss';

const { RouterProvider } = unlock( routePrivateApis );

function App() {
	const routes = useSelect(
		( select ) => select( firstAdminStore ).getRoutes(),
		[]
	);

	const router = useMemo( () => {
		return getRouter( routes );
	}, [ routes ] );

	useEffect( () => {
	}, [ router ] );

	return <RouterProvider router={ router } />;
}

/**
 * Initialize the application.
 *
 * Using a simple structure without router for now to fix the "useContext" error.
 *
 * @param routes
 * @param menuItems
 * @param metaMenuItems
 * @param initModules
 * @param dashboardContext
 */
async function init(
	routes: Route[],
	menuItems: FlatMenuItem[],
	metaMenuItems: FlatMenuItem[],
	initModules?: string[],
	dashboardContext?: DashboardContext,
	element?: HTMLElement
) {
	const rootElement = element ?? document.getElementById( 'first-admin-app' );
	if ( ! rootElement ) {
		throw new Error( "Root element with id 'first-admin-app' not found." );
	}
	// Where the site mounts the admin and its wp-admin live, from `site_url()` and `admin_url()`.
	configureSite( ( dashboardContext ?? {} ) as Record< string, unknown > );

	// Only import route modules that have beforeLoad handlers (must run at boot).
	// Other route modules are deferred and lazy-loaded on navigation.
	routes = await Promise.all(
		routes.map( async ( routeItem: Route ) => {
			if ( routeItem.route_module && routeItem.before_load ) {
				const { route } = await loadAdminModule( routeItem.route_module );
				return { ...routeItem, ...route };
			}
			return routeItem;
		} )
	);

	routes.forEach( dispatch( firstAdminStore ).registerRoute );

	menuItems.forEach( ( menuItem ) => {
		void dispatch( firstAdminStore ).registerMenuItem(
			menuItem.id,
			menuItem
		);
	} );

	metaMenuItems.forEach( ( menuItem ) => {
		void dispatch( firstAdminStore ).registerSiteHubHelpMenuItem(
			menuItem.id,
			menuItem
		);
	} );

	updateMenuIcons( dispatch( firstAdminStore ).updateMenuItem );

	if ( initModules?.length ) {
		await Promise.all(
			initModules.map( async ( initModule ) => {
				try {
					const module = await loadAdminModule( initModule );
					if ( typeof module.init === 'function' ) {
						await module.init();
					}
				} catch ( error ) {
					// eslint-disable-next-line no-console
					console.error(
						`Failed to load init module ${ initModule }:`,
						error
					);
				}
			} )
		);
	}

	if ( dashboardContext?.dashboard_widget_types ) {
		void dispatch(firstAdminStore).setDashboardWidgetTypes(dashboardContext.dashboard_widget_types);
	}
	if ( dashboardContext?.dashboard_default_layout ) {
		void dispatch(firstAdminStore).setDashboardDefaultLayout(dashboardContext.dashboard_default_layout);
	}
	if ( dashboardContext ) {
		void dispatch( firstAdminStore ).setDashboardContext( dashboardContext );
	}

	// We need to apply different view transitions for Safari, because it
	// doesn't fully support object-fit on the pseudo images and we need a
	// different, lesser, approach.
	if ( /^((?!chrome|android).)*safari/i.test( navigator.userAgent ) ) {
		document.documentElement.classList.add( 'is-safari' );
	}

	const root = createRoot( rootElement );
	root.render(
		<StrictMode>
			<App />
			<ModalRenderer />
		</StrictMode>
	);
	return () => {
		root.unmount();
		for (const route of routes) void dispatch(firstAdminStore).unregisterRoute(route.path);
		for (const item of menuItems) void dispatch(firstAdminStore).unregisterMenuItem(item.id);
		for (const item of metaMenuItems) void dispatch(firstAdminStore).unregisterSiteHubHelpMenuItem(item.id);
	};
}

// Export the init function without executing it
export default init;
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
