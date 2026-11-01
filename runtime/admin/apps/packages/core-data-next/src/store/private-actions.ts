import type { FieldCollection, ViewConfig } from './types';

/**
 * Action to receive field collections data.
 *
 * @param kind        The entity kind (e.g., 'postType', 'taxonomy').
 * @param name        The specific entity name (e.g., 'post', 'category').
 * @param collections Array of field collections associated with the entity.
 * @return Action object.
 */
export function receiveEntityFieldCollections< T >(
	kind: string,
	name: string,
	collections: FieldCollection< T >[]
) {
	return {
		type: 'RECEIVE_ENTITY_FIELD_COLLECTIONS',
		kind,
		name,
		collections,
	} as const;
}

/**
 * Action to receive editor settings data.
 *
 * @param settings The editor settings object.
 * @return Action object.
 */
export function receiveEditorSettings( settings: any ) {
	return {
		type: 'RECEIVE_EDITOR_SETTINGS',
		settings,
	} as const;
}

/**
 * Action to receive editor assets data.
 *
 * @param assets The editor assets object.
 * @return Action object.
 */
export function receiveEditorAssets( assets: any ) {
	return {
		type: 'RECEIVE_EDITOR_ASSETS',
		assets,
	} as const;
}

/**
 * Action to receive view config data.
 *
 * @param kind    The entity kind (e.g., 'root', 'postType', 'taxonomy').
 * @param name    The specific entity name (e.g., 'user', 'post', 'category').
 * @param configs View config associated with the entity.
 * @param variant Optional. View config identifier.
 * @return Action object.
 */
export function receiveEntityViewConfig(
	kind: string,
	name: string,
	configs: ViewConfig | null,
	variant?: string
) {
	return {
		type: 'RECEIVE_ENTITY_VIEW_CONFIG',
		kind,
		name,
		variant: variant ?? null,
		configs,
	} as const;
}

export type Action =
	| ReturnType< typeof receiveEntityFieldCollections >
	| ReturnType< typeof receiveEditorSettings >
	| ReturnType< typeof receiveEditorAssets >
	| ReturnType< typeof receiveEntityViewConfig >;
