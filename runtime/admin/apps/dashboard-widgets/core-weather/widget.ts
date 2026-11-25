import type { DashboardWidgetType } from '@spacepress-admin/dashboard';
import { __ } from '@wordpress/i18n';

type WeatherWidgetType = {
	location: string;
	unit: 'celsius' | 'fahrenheit';
};

const widget: Omit<
	DashboardWidgetType< WeatherWidgetType >,
	'render_module'
> = {
	name: 'core/weather',
	title: __( 'Weather (example data)', 'spacepress-admin' ),
	attributes: [
		{
			id: 'location',
			type: 'text',
			label: __( 'Location', 'spacepress-admin' ),
		},
		{
			id: 'unit',
			type: 'text',
			label: __( 'Temperature Unit', 'spacepress-admin' ),
			elements: [
				{ value: 'celsius', label: __( 'Celsius', 'spacepress-admin' ) },
				{
					value: 'fahrenheit',
					label: __( 'Fahrenheit', 'spacepress-admin' ),
				},
			],
		},
	],
	example: {
		location: 'New York',
		unit: 'celsius',
	},
};

export default widget;
