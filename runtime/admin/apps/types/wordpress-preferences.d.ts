import type { ActionCreatorsOf } from '@wordpress/data';
import type { store as preferencesStore } from '@wordpress/preferences';

/**
 * `useDispatch( preferencesStore )` does not resolve when only merged overloads
 * exist for other stores (notices, core-data). Add an explicit preferences overload.
 *
 * The generic fallback overload lives in `wordpress-data.d.ts`, which is
 * referenced first in `types/index.d.ts` so it has the lowest overload priority.
 */
declare module '@wordpress/data' {
	export function useDispatch(
		storeNameOrDescriptor: typeof preferencesStore
	): ActionCreatorsOf< typeof preferencesStore >;
}
