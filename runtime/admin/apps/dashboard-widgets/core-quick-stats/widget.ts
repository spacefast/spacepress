import type { DashboardWidgetType } from '@typedpress-admin/dashboard';
import { __ } from '@wordpress/i18n';

type QuickStatsWidgetType = {
	timeRange: 'today' | 'week' | 'month';
};

const widget: Omit<
	DashboardWidgetType< QuickStatsWidgetType >,
	'render_module'
> = {
	name: 'core/quick-stats',
	title: __( 'Quick Stats (example data)', 'typedpress-admin' ),
	info: __(
		'This widget displays key metrics and statistics for the current time range.',
		'typedpress-admin'
	),
	attributes: [
		{
			id: 'timeRange',
			type: 'text',
			label: __( 'Time Range', 'typedpress-admin' ),
			elements: [
				{ value: 'today', label: __( 'Today', 'typedpress-admin' ) },
				{ value: 'week', label: __( 'This Week', 'typedpress-admin' ) },
				{ value: 'month', label: __( 'This Month', 'typedpress-admin' ) },
			],
		},
	],
	example: {
		timeRange: 'week',
	},
};

export default widget;
