import type { Action } from './private-actions';
import type { State } from './types';
import { getViewConfigStateKey } from './utils';

const DEFAULT_STATE: State = {
	fieldCollections: {},
	viewConfigs: {},
	editorSettings: null,
	editorAssets: null,
};

/**
 * Reducer for managing field collections state.
 *
 * @param state  Current state.
 * @param action Dispatched action.
 * @return New state.
 */
export default function reducer(
	state: State = DEFAULT_STATE,
	action: Action
): State {
	switch ( action.type ) {
		case 'RECEIVE_ENTITY_FIELD_COLLECTIONS': {
			const key = `${ action.kind }-${ action.name }`;
			return {
				...state,
				fieldCollections: {
					...state.fieldCollections,
					[ key ]: action.collections,
				},
			};
		}
		case 'RECEIVE_EDITOR_SETTINGS': {
			return {
				...state,
				editorSettings: action.settings,
			};
		}
		case 'RECEIVE_EDITOR_ASSETS': {
			return {
				...state,
				editorAssets: action.assets,
			};
		}
		case 'RECEIVE_ENTITY_VIEW_CONFIG': {
			const key = getViewConfigStateKey(
				action.kind,
				action.name,
				action.variant
			);
			return {
				...state,
				viewConfigs: {
					...state.viewConfigs,
					[ key ]: action.configs,
				},
			};
		}
		default:
			return state;
	}
}
