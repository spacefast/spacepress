import { useMemo, useCallback, useState } from 'react';
import { useResizeObserver } from '@wordpress/compose';
import { Grid, type GridLayoutItem } from '@automattic/grid';
import SingleDashboardWidget from '../single-dashboard-widget';
import WidgetModalInserter from '../widget-modal-inserter';
import { useDashboardContext } from '../dashboard/context';
import { DashboardEmpty } from '../dashboard-empty';
import type { DashboardWidget } from '../../types';

/**
 * Default layout configuration values
 */
const DEFAULT_COLLAPSE_WIDTH = 640;
const DEFAULT_MIN_COLUMN_WIDTH = 350;

function DashboardWidgetsGrid() {
	const {
		layout,
		dashboardWidgets,
		editMode,
		onChange,
		onSyncLayout,
		columnsNumber,
		minColumnWidth: minColumnWidthProp,
		collapseWidth: collapseWidthProp,
		rowHeight,
	} = useDashboardContext();

	const gridLayout: GridLayoutItem[] = useMemo(
		() =>
			dashboardWidgets.map( ( widget: DashboardWidget< unknown > ) => {
				const base = {
					key: widget.uid,
					width: widget.width,
					height: widget.height,
					order: widget.order,
				};

				if ( widget.fullWidth ) {
					return { ...base, fullWidth: true as const };
				}

				return { ...base, fillWidth: widget.fillWidth };
			} ),
		[ dashboardWidgets ]
	);

	const customizeLayout = useCallback(
		( newLayout: { key: string }[] ) =>
			onChange(
				layout.map( ( widget ) => {
					const updatedWidget = newLayout.find(
						( { key } ) => key === widget.uid
					);
					return updatedWidget
						? { ...widget, ...updatedWidget }
						: widget;
				} )
			),
		[ layout, onChange ]
	);

	const updateWidget = useCallback(
		( widget: DashboardWidget< unknown > ) => {
			const updatedLayout = layout.map( ( w ) =>
				w.uid === widget.uid
					? { ...w, attributes: widget.attributes }
					: w
			);

			onSyncLayout( updatedLayout );
		},
		[ layout, onSyncLayout ]
	);

	/*
	 * Mark the widget as deleted adding the __meta.deleted flag.
	 * It will prevent extending the layout with a new widget instance
	 * through the first_admin_dashboard_widgets filter.
	 */
	const removeWidget = useCallback(
		( removedWidget: DashboardWidget< unknown > ) =>
			onChange(
				layout.map( ( widget ) =>
					widget.uid === removedWidget.uid
						? { ...widget, __meta: { deleted: true } }
						: widget
				)
			),
		[ layout, onChange ]
	);

	// Apply defaults to layout configuration values
	const collapseWidth = collapseWidthProp ?? DEFAULT_COLLAPSE_WIDTH;
	const minColumnWidth = minColumnWidthProp ?? DEFAULT_MIN_COLUMN_WIDTH;

	/*
	 * Observe container width to determine layout strategy:
	 * - Narrow (< collapseWidth): Force 1 column for better small-screen UX
	 * - Wide (>= collapseWidth): Use minColumnWidth for responsive columns
	 */
	const [ layoutWidth, setLayoutWidth ] = useState( 0 );
	const ref = useResizeObserver( ( entries ) => {
		if ( ! entries?.[ 0 ]?.contentRect?.width ) {
			return;
		}
		setLayoutWidth( entries[ 0 ].contentRect.width );
	} );

	const isCollapsed = layoutWidth < collapseWidth;

	// Prepare Grid props based on viewport
	// Grid accepts either columnsNumber OR minColumnWidth,
	// but not both (mutually exclusive)
	let gridLayoutProps;
	if ( columnsNumber ) {
		gridLayoutProps = { columns: columnsNumber };
	} else if ( isCollapsed ) {
		gridLayoutProps = { columns: 1 };
	} else {
		gridLayoutProps = { minColumnWidth };
	}

	return (
		<div ref={ ref }>
			<Grid
				layout={ gridLayout }
				spacing={ 4 }
				editMode={ editMode }
				onChangeLayout={ customizeLayout }
				rowHeight={ rowHeight ?? 200 }
				{ ...gridLayoutProps }
			>
				{ dashboardWidgets.map( ( widget ) => (
					<SingleDashboardWidget
						key={ widget.uid }
						widget={ widget }
						isDisabled={ !! editMode }
						onChange={ updateWidget }
						actionableArea={
							editMode && (
								<SingleDashboardWidget.AdminActions
									widget={ widget }
									onWidgetRemove={ removeWidget }
								/>
							)
						}
					/>
				) ) }
			</Grid>
		</div>
	);
}

export default function DashboardWidgets() {
	const {
		dashboardWidgets,
		isModalOpen,
		onCloseWidgetsModal,
		onInsertWidgets,
	} = useDashboardContext();

	const hasWidgets = dashboardWidgets.length > 0;

	return (
		<>
			{ hasWidgets ? <DashboardWidgetsGrid /> : <DashboardEmpty /> }

			{ isModalOpen && (
				<WidgetModalInserter
					onClose={ onCloseWidgetsModal }
					onInsert={ onInsertWidgets }
				/>
			) }
		</>
	);
}
