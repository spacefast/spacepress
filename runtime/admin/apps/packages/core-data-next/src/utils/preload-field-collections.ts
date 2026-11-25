import { store } from '../store';
import type { FieldCollection } from '../store/types';

/**
 * Preload field collections data and script modules for better performance.
 * This should be called from route loaders to eliminate loading states.
 *
 * @param kind Entity kind (e.g., 'postType', 'taxonomy', 'user')
 * @param name Entity name (e.g., 'attachment', 'post', 'category')
 * @return Promise that resolves when both data and modules are loaded
 */
export async function preloadFieldCollections(
	kind: string,
	name: string
): Promise< void > {
	const { resolveSelect } = await import( '@wordpress/data' );

	// SpacePress, resolve the field collections data
	const collections = ( await resolveSelect(
		store
	).getEntityFieldCollections( kind, name ) ) as FieldCollection< any >[];

	// Then preload all the script modules
	const modulePromises = collections
		.filter( ( collection ) => collection.fields_module )
		.map( async ( collection ) => {
			await import( collection.fields_module! );
		} );

	// Wait for all modules to load
	await Promise.all( modulePromises );
}
