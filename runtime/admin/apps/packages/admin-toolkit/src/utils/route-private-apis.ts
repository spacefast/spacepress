import { unlock } from '@zero-admin/private-apis';
import {
	privateApis as routePrivateApis,
	type AnyRouter,
} from '@wordpress/route';

interface RoutePrivateApis {
	useRouter: () => AnyRouter;
	useRouterState: < T >( opts?: {
		select?: ( state: AnyRouter[ 'state' ] ) => T;
	} ) => T;
	useLocation: () => AnyRouter[ 'state' ][ 'location' ];
	useMatches: () => AnyRouter[ 'state' ][ 'matches' ];
}

function isRoutePrivateApis( value: unknown ): value is RoutePrivateApis {
	return (
		value !== null &&
		typeof value === 'object' &&
		'useRouter' in value &&
		'useRouterState' in value &&
		'useLocation' in value &&
		'useMatches' in value
	);
}

function getRoutePrivateApis(): RoutePrivateApis {
	const apis: unknown = unlock( routePrivateApis );
	if ( ! isRoutePrivateApis( apis ) ) {
		throw new Error( 'Missing private APIs in @wordpress/route' );
	}
	return apis;
}

const routeApis = getRoutePrivateApis();

export const { useRouter, useRouterState, useLocation, useMatches } = routeApis;
