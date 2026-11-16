import { useEffect, useRef } from '@wordpress/element';
import { privateApis as routePrivateApis } from '@wordpress/route';
import { unlock } from '@typedpress-admin/admin-toolkit';
import type { Ability } from '@wordpress/abilities';
import { getAbilities, unregisterAbility } from '@wordpress/abilities';

const { useRouter } = unlock( routePrivateApis );

/**
 * Hook that automatically cleans up route-scoped abilities on navigation.
 *
 * This hook subscribes to router navigation events and unregisters any abilities
 * that are marked with `meta.scope = 'route'`. This ensures route-specific abilities
 * don't accumulate as users navigate through the application.
 *
 * Abilities without the 'route' scope are left untouched (app-level abilities).
 */
export function useAbilitiesCleanupOnNavigation(): void {
	const router = useRouter();
	const previousPathnameRef = useRef< string | null >( null );

	useEffect( () => {
		// Initialize with current pathname
		previousPathnameRef.current = router.state.location.pathname;

		// Compare the current pathname with the new pathname to determine if we're
		// navigating to a different route. If we are, we clean up the current route's abilities.
		const unsubscribe = router.subscribe(
			'onLoad',
			async ( { toLocation }: { toLocation: { pathname: string } } ) => {
				const currentPathname = previousPathnameRef.current;
				const newPathname = toLocation.pathname;

				// Only clean up if we're actually navigating to a different route
				if (
					currentPathname !== null &&
					currentPathname !== newPathname
				) {
					try {
						const abilities = await getAbilities();

						// Filter to only route-scoped abilities (opt-in via metadata)
						const routeAbilities = abilities.filter(
							( ability: Ability ) =>
								ability.meta?.scope === 'route'
						);

						// Clean up all route-scoped abilities from the current route
						// before navigating to the new route
						routeAbilities.forEach( ( ability: Ability ) => {
							unregisterAbility( ability.name );
						} );
					} catch ( error ) {
						// eslint-disable-next-line no-console
						console.error( 'Error during ability cleanup:', error );
					}
				}

				// Update the ref for the next navigation
				previousPathnameRef.current = newPathname;
			}
		);

		return unsubscribe;
	}, [ router ] );
}
