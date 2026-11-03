import { useMemo, useCallback, useState, useEffect } from 'react';
import { Stack } from '@wordpress/ui';
import fastDeepEqual from 'fast-deep-equal/es6';
import { DashboardActions } from '../dashboard-actions';
import DashboardWidgets from '../dashboard-widgets';
import DashboardNotices from '../dashboard-notices';
import { DashboardProvider } from './context';
import type { DashboardWidget, DashboardProps } from '../../types';

type DefaultDashboardProps = Pick<
	Parameters< typeof Stack >[ 0 ],
	'direction' | 'gap' | 'align' | 'justify'
> & {
	className?: string;
};

function DefaultDashboard( {
	className,
	direction = 'column',
	gap = 'lg',
	align = 'stretch',
	justify = 'left',
}: DefaultDashboardProps ) {
	return (
		<Stack
			direction={ direction }
			gap={ gap }
			align={ align }
			justify={ justify }
			className={ className }
		>
			<DashboardActions />
			<DashboardWidgets />
		</Stack>
	);
}

function Dashboard( {
	children,
	layout: committedLayout,
	onChange,
	widgetTypes,
	notices,
	onNoticeAction,
	onWidgetError,
	columnsNumber,
	minColumnWidth,
	collapseWidth,
	rowHeight,
}: DashboardProps ) {
	const [ editMode, setEditMode ] = useState( false );
	const [ isModalOpen, setModalOpen ] = useState( false );

	// Internal staging state
	const [ stagingLayout, setStagingLayout ] = useState( committedLayout );

	// Sync staging with committed when committed changes externally
	useEffect( () => setStagingLayout( committedLayout ), [ committedLayout ] );

	// Helper to check if two layouts differ
	const hasLayoutChanges = useCallback(
		(
			layoutA: DashboardWidget< unknown >[],
			layoutB: DashboardWidget< unknown >[]
		) => {
			// Quick check based on length
			if ( layoutA?.length !== layoutB?.length ) {
				return true;
			}

			return layoutA?.some(
				( item, i ) => ! fastDeepEqual( item, layoutB?.[ i ] )
			);
		},
		[]
	);

	const isDirty = useMemo(
		() => hasLayoutChanges( committedLayout, stagingLayout ),
		[ committedLayout, stagingLayout, hasLayoutChanges ]
	);

	const startCustomization = useCallback( () => setEditMode( true ), [] );

	const cancelCustomization = useCallback( () => {
		setEditMode( false );
		setStagingLayout( committedLayout );
	}, [ committedLayout ] );

	const syncLayout = useCallback(
		( layout: DashboardWidget< unknown >[] ) => {
			if ( ! hasLayoutChanges( committedLayout, layout ) ) {
				return;
			}

			onChange( layout, { source: 'direct' } );
		},
		[ committedLayout, onChange, hasLayoutChanges ]
	);

	const syncStaging = useCallback( () => {
		setEditMode( false );

		if ( ! isDirty ) {
			return;
		}

		onChange( stagingLayout, { source: 'commit' } );
	}, [ isDirty, onChange, stagingLayout ] );

	const openWidgetsModal = useCallback( () => setModalOpen( true ), [] );

	const insertWidgets = useCallback(
		( widgets: DashboardWidget< unknown >[] ) => {
			setStagingLayout( [ ...stagingLayout, ...widgets ] );
		},
		[ stagingLayout ]
	);

	const dashboardWidgets = useMemo(
		() => stagingLayout.filter( ( widget ) => ! widget.__meta?.deleted ),
		[ stagingLayout ]
	);

	/*
	 * When no dashboard widgets, start in edit mode.
	 * Widget Actions component will adapt to the empty state.
	 */
	useEffect( () => {
		if ( dashboardWidgets.length > 0 ) {
			return;
		}

		setEditMode( true );
	}, [ dashboardWidgets ] );

	const contextValue = useMemo(
		() => ( {
			editMode,
			hasChanges: isDirty,
			layout: stagingLayout,
			dashboardWidgets,
			widgetTypes: widgetTypes ?? [],
			notices: notices ?? [],
			onNoticeAction,
			columnsNumber,
			minColumnWidth,
			collapseWidth,
			rowHeight,
			onEdit: startCustomization,
			onCancel: cancelCustomization,
			onChange: setStagingLayout,
			onSyncStaging: syncStaging,
			onSyncLayout: syncLayout,
			onInsertWidgets: insertWidgets,
			onOpenWidgetsModal: openWidgetsModal,
			onCloseWidgetsModal: () => setModalOpen( false ),
			isModalOpen,
			onWidgetError,
		} ),
		[
			editMode,
			isDirty,
			stagingLayout,
			dashboardWidgets,
			widgetTypes,
			notices,
			onNoticeAction,
			columnsNumber,
			minColumnWidth,
			collapseWidth,
			rowHeight,
			startCustomization,
			cancelCustomization,
			syncStaging,
			syncLayout,
			openWidgetsModal,
			insertWidgets,
			isModalOpen,
			onWidgetError,
		]
	);

	return (
		<DashboardProvider value={ contextValue }>
			{ children ?? <DefaultDashboard /> }
		</DashboardProvider>
	);
}

Dashboard.Actions = DashboardActions;
Dashboard.Widgets = DashboardWidgets;
Dashboard.Notices = DashboardNotices;

export default Dashboard;
