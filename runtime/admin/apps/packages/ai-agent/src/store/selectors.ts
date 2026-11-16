import type { State } from './reducer';

export function getContextEntries( state: State ): State[ 'contextEntries' ] {
	return state.contextEntries;
}
