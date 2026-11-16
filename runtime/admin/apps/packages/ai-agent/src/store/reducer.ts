import type { ContextEntry } from './types';

export interface State {
	contextEntries: ContextEntry[];
}

export const initialState: State = {
	contextEntries: [],
};

type Action =
	| { type: 'ADD_CONTEXT_ENTRY'; entry: ContextEntry }
	| { type: 'REMOVE_CONTEXT_ENTRY'; id: string }
	| { type: 'CLEAR_CONTEXT_ENTRIES' };

export default function reducer(
	state: State = initialState,
	action: Action
): State {
	switch ( action.type ) {
		case 'ADD_CONTEXT_ENTRY':
			// Replace if entry with same ID exists, otherwise add
			return {
				...state,
				contextEntries: [
					...state.contextEntries.filter(
						( entry ) => entry.id !== action.entry.id
					),
					action.entry,
				],
			};

		case 'REMOVE_CONTEXT_ENTRY':
			return {
				...state,
				contextEntries: state.contextEntries.filter(
					( entry ) => entry.id !== action.id
				),
			};

		case 'CLEAR_CONTEXT_ENTRIES':
			return {
				...state,
				contextEntries: [],
			};

		default:
			return state;
	}
}
