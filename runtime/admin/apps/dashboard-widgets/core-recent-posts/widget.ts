import type { DashboardWidgetType } from '@spacepress-admin/dashboard';
import { __ } from '@wordpress/i18n';

type RecentPostsWidgetType = { numberOfPosts: number; showExcerpts: boolean };

const widget: Omit<
	DashboardWidgetType< RecentPostsWidgetType >,
	'render_module'
> = {
	name: 'core/recent-posts',
	title: __( 'Recent Posts (example data)', 'spacepress-admin' ),
	attributes: [
		{
			id: 'numberOfPosts',
			type: 'integer',
			label: __( 'Number of Posts', 'spacepress-admin' ),
		},
		{
			id: 'showExcerpts',
			type: 'boolean',
			label: __( 'Show Excerpts', 'spacepress-admin' ),
		},
	],
	example: {
		numberOfPosts: 5,
		showExcerpts: true,
	},
};

export default widget;
