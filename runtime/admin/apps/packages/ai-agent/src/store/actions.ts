import type { ContextEntry } from './types';

export function addContextEntry( entry: ContextEntry ) {
	return {
		type: 'ADD_CONTEXT_ENTRY' as const,
		entry,
	};
}

export function removeContextEntry( id: string ) {
	return {
		type: 'REMOVE_CONTEXT_ENTRY' as const,
		id,
	};
}

export function clearContextEntries() {
	return {
		type: 'CLEAR_CONTEXT_ENTRIES' as const,
	};
}
