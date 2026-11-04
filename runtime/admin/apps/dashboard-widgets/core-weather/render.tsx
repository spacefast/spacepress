interface WeatherRenderProps {
	attributes: {
		location?: string;
		unit?: 'celsius' | 'fahrenheit';
	};
}

export default function WeatherRender( { attributes }: WeatherRenderProps ) {
	const location = attributes.location || 'Hong Kong';
	const unit = attributes.unit || 'celsius';
	const temperature = unit === 'fahrenheit' ? '72°F' : '22°C';

	return (
		<div>
			<p>Location: { location }</p>
			<p>Temperature: { temperature }</p>
		</div>
	);
}
