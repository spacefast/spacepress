interface QuickStatsRenderProps {
	attributes: {
		timeRange?: 'today' | 'week' | 'month';
	};
}

export default function QuickStatsRender( {
	attributes,
}: QuickStatsRenderProps ) {
	const timeRange = attributes.timeRange || 'today';
	const stats =
		timeRange === 'week'
			? {
					visitors: '8,567',
					pageViews: '24,890',
					bounceRate: '38%',
					avgSession: '4:12',
			  }
			: {
					visitors: '1,234',
					pageViews: '5,678',
					bounceRate: '42%',
					avgSession: '3:45',
			  };
	return (
		<div
			style={ {
				display: 'grid',
				gridTemplateColumns: 'repeat(2, 1fr)',
				gap: '8px',
			} }
		>
			<div>
				<strong>Visitors:</strong> { stats.visitors }
			</div>
			<div>
				<strong>Page Views:</strong> { stats.pageViews }
			</div>
			<div>
				<strong>Bounce Rate:</strong> { stats.bounceRate }
			</div>
			<div>
				<strong>Avg. Session:</strong> { stats.avgSession }
			</div>
		</div>
	);
}
