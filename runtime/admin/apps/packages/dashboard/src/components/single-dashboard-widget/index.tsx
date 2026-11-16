import { IconButton, Stack } from '@wordpress/ui';
import { useCallback, useState, useEffect } from 'react';
import clsx from 'clsx';
import { Card } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { trash } from '@wordpress/icons';
import './style.scss';
import type { DashboardWidget, WidgetErrorConfig } from '../../types';
import { useDashboardContext } from '../dashboard/context';
import { WidgetContextProvider } from '../widget-context';
import DashboardWidgetHeader from './header';
import DashboardWidgetSettings from './settings';
import WidgetRender from '../widget-render';
import { WidgetErrorBoundary } from '../widget-error-boundary';
import type { WidgetBadgeProp } from './badge';

type SingleDashboardWidgetActionsProps = {
	widget: DashboardWidget< unknown >;
	onWidgetRemove: ( widget: DashboardWidget< unknown > ) => void;
};

function SingleDashboardWidgetAdminActions( {
	widget,
	onWidgetRemove,
}: SingleDashboardWidgetActionsProps ) {
	const removeHandler = useCallback( () => {
		onWidgetRemove( widget );
	}, [ onWidgetRemove, widget ] );

	return (
		<Stack
			direction="row"
			gap="sm"
			justify="flex-end"
			className="typedpress-admin-dashboard-widget-actions"
		>
			<IconButton
				icon={ trash }
				size="small"
				variant="minimal"
				tone="neutral"
				onClick={ removeHandler }
				label={ __( 'Remove', 'typedpress-admin' ) }
			/>
		</Stack>
	);
}

type SingleDashboardWidgetProps = {
	widget: DashboardWidget< unknown >;
	isDisabled: boolean;
	onChange: ( widget: DashboardWidget< unknown > ) => void;
	actionableArea?: React.ReactNode;
};

export default function SingleDashboardWidget( {
	widget,
	isDisabled,
	onChange,
}: SingleDashboardWidgetProps ) {
	const { widgetTypes, onWidgetError, layout, onSyncLayout, rowHeight } =
		useDashboardContext();

	// State for badge updates from widget render component
	const [ badge, setBadgeState ] = useState< WidgetBadgeProp >( null );

	// State for error config from widget render component
	const [ errorConfig, setErrorConfig ] = useState<
		WidgetErrorConfig | true | null
	>( null );

	// Callback for widget render component to update badge
	const setBadge = useCallback( ( updatedBadge: WidgetBadgeProp ) => {
		setBadgeState( updatedBadge );
	}, [] );

	// Callback for widget render component to report error
	const setError = useCallback(
		( error: WidgetErrorConfig | true | null ) => {
			setErrorConfig( error );
		},
		[]
	);

	// Handler for error boundary caught errors (use default)
	const handleBoundaryError = useCallback( () => {
		setErrorConfig( true );
	}, [] );

	// Remove widget directly (persists immediately, no edit mode).
	const onRemove = useCallback( () => {
		onSyncLayout(
			layout.map( ( w ) =>
				w.uid === widget.uid ? { ...w, __meta: { deleted: true } } : w
			)
		);
	}, [ layout, onSyncLayout, widget.uid ] );

	// Report error state changes to parent dashboard
	useEffect( () => {
		onWidgetError?.( widget.uid, errorConfig );

		// Clean up error state when component unmounts
		return () => {
			onWidgetError?.( widget.uid, null );
		};
	}, [ widget.uid, errorConfig, onWidgetError ] );

	// Find the widget type from context
	const widgetType = widgetTypes.find( ( w ) => w.name === widget.type );

	if ( ! widgetType ) {
		//eslint-disable-next-line no-console
		console.error( `Unknown dashboard widget: ${ widget.type }` );
		return null;
	}

	// Extract layout configuration with defaults
	const widgetLayout = widgetType.layout || {};
	const shouldApplyPadding = widgetLayout.contentPadding !== false;
	const hasScrollableContent = widgetLayout.scrollableContent === true;

	// Determine if header should be shown based on available content
	const hasHeaderContent =
		!! widgetType.title ||
		!! widgetType.icon ||
		!! widgetType.info ||
		!! widgetType.description;

	// Settings are independent from header visibility
	const hasSettings = ! isDisabled && !! widgetType.attributes?.length;

	const widgetClasses = clsx(
		'typedpress-admin-dashboard-widget',
		hasScrollableContent && 'typedpress-admin-dashboard-widget--fade-overlay',
		rowHeight !== 'auto' && 'typedpress-admin-dashboard-widget--fixed-height'
	);

	const contentClasses = clsx(
		'typedpress-admin-dashboard-widget__content',
		! shouldApplyPadding &&
			'typedpress-admin-dashboard-widget__content--no-padding'
	);

	return (
		<WidgetContextProvider value={ widget.uid }>
			<Card
				className={ widgetClasses }
				{ ...( isDisabled ? { inert: 'true' } : {} ) }
			>
				{ hasHeaderContent && (
					<Stack
						direction="row"
						justify="space-between"
						align="center"
						gap="sm"
					>
						<DashboardWidgetHeader
							widgetType={ widgetType }
							badge={ badge }
						/>

						{ hasSettings && (
							<DashboardWidgetSettings
								widget={ widget }
								widgetType={ widgetType }
								onChange={ onChange }
							/>
						) }
					</Stack>
				) }

				{ ! hasHeaderContent && hasSettings && (
					<DashboardWidgetSettings
						widget={ widget }
						widgetType={ widgetType }
						onChange={ onChange }
					/>
				) }

				<div className={ contentClasses }>
					<WidgetErrorBoundary
						errorConfig={ errorConfig }
						onError={ handleBoundaryError }
					>
						<WidgetRender
							widget={ widget }
							widgetType={ widgetType }
							onRemove={ onRemove }
							setBadge={ setBadge }
							setError={ setError }
						/>
					</WidgetErrorBoundary>
				</div>
			</Card>
		</WidgetContextProvider>
	);
}

SingleDashboardWidget.AdminActions = SingleDashboardWidgetAdminActions;
