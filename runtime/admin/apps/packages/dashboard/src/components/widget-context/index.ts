import { createContext, useContext, useMemo } from 'react';
import { useDashboardContext } from '../dashboard/context';

export interface DashboardWidgetContextValue {
	uid: string;
	name: string;
	position: number;
}

/**
 * @deprecated Use `DashboardWidgetContextValue` instead.
 */
export type WidgetContextValue = DashboardWidgetContextValue;

const WidgetUidContext = createContext< string | null >( null );

export const WidgetContextProvider = WidgetUidContext.Provider;

/**
 * Returns the current widget's identity — name, uid, and position
 * in the dashboard grid. Must be called within a dashboard widget component.
 *
 * Returns `null` when called outside a dashboard widget context.
 */
export function useDashboardWidgetContext(): DashboardWidgetContextValue | null {
	const uid = useContext( WidgetUidContext );
	const { dashboardWidgets } = useDashboardContext();

	return useMemo( () => {
		if ( ! uid ) {
			return null;
		}

		const index = dashboardWidgets.findIndex( ( w ) => w.uid === uid );
		const widget = dashboardWidgets[ index ];

		if ( ! widget ) {
			return null;
		}

		return {
			uid,
			name: widget.type,
			position: index,
		};
	}, [ uid, dashboardWidgets ] );
}

/**
 * @deprecated Use `useDashboardWidgetContext` instead.
 */
export function useWidgetContext(): DashboardWidgetContextValue | null {
	// eslint-disable-next-line no-console
	console.warn(
		'useWidgetContext is deprecated. Use useDashboardWidgetContext instead.'
	);
	return useDashboardWidgetContext();
}
