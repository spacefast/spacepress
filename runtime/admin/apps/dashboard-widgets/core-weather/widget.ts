import type { DashboardWidgetType } from '@first-admin/dashboard';
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
	title: __( 'Weather (example data)', 'first-admin' ),
	attributes: [
		{
			id: 'location',
			type: 'text',
			label: __( 'Location', 'first-admin' ),
		},
		{
			id: 'unit',
			type: 'text',
			label: __( 'Temperature Unit', 'first-admin' ),
			elements: [
				{ value: 'celsius', label: __( 'Celsius', 'first-admin' ) },
				{
					value: 'fahrenheit',
					label: __( 'Fahrenheit', 'first-admin' ),
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
