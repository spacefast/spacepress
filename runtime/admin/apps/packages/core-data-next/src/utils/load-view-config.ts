import { store } from '../store';
import type { ViewConfig } from '../store/types';

/**
 * Load a view configuration for the given entity.
 * This should be called from route loaders to eliminate loading states.
 *
 * @param kind    Entity kind (e.g., 'postType', 'taxonomy', 'root')
 * @param name    Entity name (e.g., 'product', 'category', 'user')
 * @param variant Optional. View config identifier
 * @return Promise that resolves with the view configuration
 */
export async function loadViewConfig(
	kind: string,
	name: string,
	variant?: string
): Promise< ViewConfig | null > {
	const { resolveSelect } = await import( '@wordpress/data' );

	return resolveSelect( store ).getEntityViewConfig( kind, name, variant );
}
