import { useDispatch, useSelect } from '@wordpress/data';
import { store as preferencesStore } from '@wordpress/preferences';
import {
	store as tpAdminStore,
	type StoreSelectors,
} from '@typedpress-admin/boot';
import type { DashboardWidget } from '@typedpress-admin/dashboard';

/**
 * Hook for managing dashboard layout preferences.
 *
 * Uses `tpDashboardLayout` by default so legacy upstream stub layouts are replaced
 * by SpacePress's real default widgets while keeping user customizations persisted.
 */
function useDashboardLayout(
	preferenceKey: string = 'tpDashboardLayout',
	fallbackLayout?: DashboardWidget< unknown >[]
): [
	DashboardWidget< unknown >[],
	( layout: DashboardWidget< unknown >[] ) => void,
	() => void,
] {
	const storedLayout = useSelect(
		( select ) =>
			// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- preferences store returns `unknown`
			select( preferencesStore ).get( 'core/admin', preferenceKey ) as
				| DashboardWidget< unknown >[]
				| undefined,
		[ preferenceKey ]
	);

	const { set } = useDispatch( preferencesStore );

	function setLayout( newLayout: DashboardWidget< unknown >[] ) {
		void set( 'core/admin', preferenceKey, newLayout );
	}

	const bootDefaultLayout = useSelect(
		( select ) =>
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return -- StoreSelectors cast
			(
				select( tpAdminStore ) as StoreSelectors
			 ).getDashboardDefaultLayout(),
		[]
	);

	const defaultLayout = fallbackLayout ?? bootDefaultLayout;
	const layout = storedLayout ?? defaultLayout;

	function resetLayout() {
		void set( 'core/admin', preferenceKey, defaultLayout );
	}

	return [ layout, setLayout, resetLayout ];
}

export default useDashboardLayout;
