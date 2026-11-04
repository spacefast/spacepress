import { createContext, useContext } from 'react';
import type { GridProps } from '@automattic/grid';
import type {
	DashboardWidget,
	DashboardWidgetType,
	DashboardNoticeType,
	WidgetErrorConfig,
} from '../../types';

interface DashboardContextValue {
	/**
	 * Available widget types that can be added to the dashboard.
	 */
	widgetTypes: DashboardWidgetType< unknown >[];

	/**
	 * Dashboard notices to display.
	 */
	notices: DashboardNoticeType[];

	/**
	 * Callback when a notice action is clicked.
	 */
	onNoticeAction?: ( noticeId: string, actionId: string ) => void;

	/**
	 * Fixed number of columns, bypassing responsive behavior.
	 */
	columnsNumber?: GridProps[ 'columns' ];

	/**
	 * Minimum column width in pixels for responsive grid layout.
	 */
	minColumnWidth?: GridProps[ 'minColumnWidth' ];

	/**
	 * Breakpoint in pixels below which dashboard switches to single column.
	 */
	collapseWidth?: number;

	/**
	 * Height of each widget row in pixels, or 'auto' to size by content.
	 */
	rowHeight?: GridProps[ 'rowHeight' ];

	/*
	 * The current layout of the dashboard.
	 */
	layout: DashboardWidget< unknown >[];

	/*
	 * Current dashboard widgets in the layout.
	 * It excludes widgets that are marked as deleted.
	 */
	dashboardWidgets: DashboardWidget< unknown >[];

	/*
	 * Current mode of the dashboard.
	 * Whe true, it will possible to add or remove widgets,
	 * change widgets sizes, positions, etc.
	 */
	editMode: boolean;

	/*
	 * Whether the layout has been modified since the last state.
	 */
	hasChanges: boolean;

	/**
	 * Change the editMode state.
	 */
	onEdit: () => void;

	/*
	 * Cancel the current edition, losing the current layout changes.
	 */
	onCancel: () => void;

	/**
	 * Change the dashboard customization.
	 */
	onChange: ( layout: DashboardWidget< unknown >[] ) => void;

	/*
	 * Sync staging layout to parent (used when exiting edit mode).
	 */
	onSyncStaging: () => void;

	/*
	 * Sync a specific layout to parent (bypasses staging).
	 */
	onSyncLayout: ( layout: DashboardWidget< unknown >[] ) => void;

	/*
	 * Whether the widgets modal inserter is open.
	 */
	isModalOpen: boolean;

	/*
	 * Open the widgets modal inserter.
	 */
	onOpenWidgetsModal: () => void;

	/*
	 * Close the widgets modal inserter.
	 */
	onCloseWidgetsModal: () => void;

	/*
	 * Insert new widgets into the layout.
	 */
	onInsertWidgets: ( widgets: DashboardWidget< unknown >[] ) => void;

	/**
	 * Report a widget error state change.
	 * Called when a widget reports or clears an error.
	 *
	 * @param uid   - The widget's unique identifier.
	 * @param error - The error config (`true` for default, object for custom), or `null` if cleared.
	 */
	onWidgetError?: (
		uid: string,
		error: WidgetErrorConfig | true | null
	) => void;
}

const DashboardContext = createContext< DashboardContextValue | null >( null );

export const DashboardProvider = DashboardContext.Provider;

export function useDashboardContext() {
	const context = useContext( DashboardContext );
	if ( ! context ) {
		throw new Error(
			'Dashboard compound components must be used within Dashboard'
		);
	}
	return context;
}
