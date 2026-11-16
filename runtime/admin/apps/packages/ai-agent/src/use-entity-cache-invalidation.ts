/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion */
// TODO: Add proper types for WordPress data store dispatch and apiFetch middleware

import { useEffect } from '@wordpress/element';
import { dispatch } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
// eslint-disable-next-line no-restricted-imports
import apiFetch from '@wordpress/api-fetch';

/**
 * Map of entity types to abilities that should trigger their cache invalidation.
 */
const ENTITY_INVALIDATION_MAP: Record< string, string[] > = {
	product: [
		'woocommerce/create-product',
		'woocommerce/create-bookable-product',
		'woocommerce/update-product',
		'woocommerce/delete-product',
	],
};

let isRegistered = false;

/**
 * Parse ability name from wp-abilities API path.
 *
 * @param path API request path
 * @return Ability name in 'namespace/ability' format or null
 */
function parseAbilityFromPath( path: string ): string | null {
	const match = path.match(
		/abilities\/(?<namespace>[^/]+)\/(?<ability>[^/?]+)\/run/
	);
	if ( ! match?.groups ) {
		return null;
	}
	return `${ match.groups.namespace }/${ match.groups.ability }`;
}

/**
 * Get entity names that should be invalidated for a given ability.
 *
 * @param abilityName The ability name to lookup
 * @return Array of entity names to invalidate
 */
function getEntitiesToInvalidate( abilityName: string ): string[] {
	return Object.entries( ENTITY_INVALIDATION_MAP )
		.filter( ( [ , abilities ] ) => abilities.includes( abilityName ) )
		.map( ( [ entityName ] ) => entityName );
}

/**
 * Invalidate WordPress entity caches for given entity names.
 *
 * @param entityNames Entity names to invalidate
 */
function invalidateEntities( entityNames: string[] ): void {
	const coreDispatch = dispatch( coreStore as any ) as any;
	entityNames.forEach( ( entityName ) => {
		coreDispatch.invalidateResolution?.( 'getEntityRecords', [
			'root',
			entityName,
		] );
	} );
	coreDispatch.invalidateResolutionForStoreSelector?.( 'getEntityRecords' );
}

/**
 * Hook that invalidates entity caches when abilities are executed successfully.
 */
export function useEntityCacheInvalidation(): void {
	useEffect( () => {
		if ( isRegistered ) {
			return;
		}

		apiFetch.use(
			(
				options: Record< string, any >,
				next: ( options: Record< string, any > ) => Promise< any >
			) => {
				return next( options ).then( ( response ) => {
					// Response may be null for some requests e.g. if the response was 204 No Content
					if ( ! response ) {
						return response;
					}

					if ( ! response.success ) {
						return response;
					}

					const path = options.path || options.url || '';
					const abilityName =
						typeof path === 'string'
							? parseAbilityFromPath( path )
							: null;

					if ( abilityName ) {
						const entities = getEntitiesToInvalidate( abilityName );
						if ( entities.length > 0 ) {
							invalidateEntities( entities );
						}
					}

					return response;
				} );
			}
		);

		isRegistered = true;
	}, [] );
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion */
