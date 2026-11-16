import type { DashboardWidgetType } from '@typedpress-admin/dashboard';
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
	title: __( 'Weather (example data)', 'typedpress-admin' ),
	attributes: [
		{
			id: 'location',
			type: 'text',
			label: __( 'Location', 'typedpress-admin' ),
		},
		{
			id: 'unit',
			type: 'text',
			label: __( 'Temperature Unit', 'typedpress-admin' ),
			elements: [
				{ value: 'celsius', label: __( 'Celsius', 'typedpress-admin' ) },
				{
					value: 'fahrenheit',
					label: __( 'Fahrenheit', 'typedpress-admin' ),
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
