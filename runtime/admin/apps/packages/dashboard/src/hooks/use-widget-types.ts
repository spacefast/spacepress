import { useState, useEffect } from '@wordpress/element';
import { resolveWidgetTypes } from '../utils/resolve-widget-types';
import type {
	DashboardWidgetType,
	RegisteredDashboardWidgetType,
} from '../types';

/**
 * Resolve registered widget types into fully-hydrated objects.
 *
 * @param registered - Array of registered widget types from PHP.
 * @return Resolved widget types.
 */
export function useWidgetTypes(
	registered: RegisteredDashboardWidgetType[]
): DashboardWidgetType< unknown >[] {
	const [ widgetTypes, setWidgetTypes ] = useState<
		DashboardWidgetType< unknown >[]
	>( [] );

	useEffect( () => {
		if ( ! registered?.length ) {
			return;
		}

		const abortController = new AbortController();

		void resolveWidgetTypes( registered, {
			signal: abortController.signal,
		} ).then( ( resolved ) => {
			if ( ! abortController.signal.aborted ) {
				setWidgetTypes( resolved );
			}
		} );

		return () => {
			abortController.abort();
		};
	}, [ registered ] );

	return widgetTypes;
}
