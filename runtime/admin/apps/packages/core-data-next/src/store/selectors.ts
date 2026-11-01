import type { FieldCollection, State, ViewConfig } from './types';
import { getViewConfigStateKey } from './utils';

/**
 * Selector to get field collections for a specific entity kind and name.
 *
 * @param state Current state.
 * @param kind  Entity kind (e.g., 'postType', 'taxonomy').
 * @param name  Entity name (e.g., 'post', 'category').
 * @return Array of field collections for the specified entity.
 */
export function getEntityFieldCollections< T >(
	state: State,
	kind: string,
	name: string
): FieldCollection< T >[] {
	const key = `${ kind }-${ name }`;
	return state.fieldCollections[ key ] || [];
}

/**
 * Selector to get editor settings.
 *
 * @param state Current state.
 * @return Editor settings object or null if not loaded.
 */
export function getEditorSettings( state: State ) {
	return state.editorSettings;
}

/**
 * Selector to get editor assets.
 *
 * @param state Current state.
 * @return Editor assets object or null if not loaded.
 */
export function getEditorAssets( state: State ) {
	return state.editorAssets;
}

/**
 * Selector to get view config for a specific entity kind and name.
 *
 * @param state   Current state.
 * @param kind    Entity kind (e.g., 'root', 'postType', 'taxonomy').
 * @param name    Entity name (e.g., 'user', 'post', 'category').
 * @param variant Optional. View config identifier.
 * @return View config for the specified entity or null if not found.
 */
export function getEntityViewConfig(
	state: State,
	kind: string,
	name: string,
	variant?: string | null
): ViewConfig | null {
	const key = getViewConfigStateKey( kind, name, variant );
	return state.viewConfigs[ key ] || null;
}
