import type { DashboardWidgetType } from '@spacepress-admin/dashboard';
import { __ } from '@wordpress/i18n';

type QuickStatsWidgetType = {
	timeRange: 'today' | 'week' | 'month';
};

const widget: Omit<
	DashboardWidgetType< QuickStatsWidgetType >,
	'render_module'
> = {
	name: 'core/quick-stats',
	title: __( 'Quick Stats (example data)', 'spacepress-admin' ),
	info: __(
		'This widget displays key metrics and statistics for the current time range.',
		'spacepress-admin'
	),
	attributes: [
		{
			id: 'timeRange',
			type: 'text',
			label: __( 'Time Range', 'spacepress-admin' ),
			elements: [
				{ value: 'today', label: __( 'Today', 'spacepress-admin' ) },
				{ value: 'week', label: __( 'This Week', 'spacepress-admin' ) },
				{ value: 'month', label: __( 'This Month', 'spacepress-admin' ) },
			],
		},
	],
	example: {
		timeRange: 'week',
	},
};

export default widget;
