import type { DashboardWidgetType } from '@first-admin/dashboard';
import { __ } from '@wordpress/i18n';

type RecentPostsWidgetType = { numberOfPosts: number; showExcerpts: boolean };

const widget: Omit<
	DashboardWidgetType< RecentPostsWidgetType >,
	'render_module'
> = {
	name: 'core/recent-posts',
	title: __( 'Recent Posts (example data)', 'first-admin' ),
	attributes: [
		{
			id: 'numberOfPosts',
			type: 'integer',
			label: __( 'Number of Posts', 'first-admin' ),
		},
		{
			id: 'showExcerpts',
			type: 'boolean',
			label: __( 'Show Excerpts', 'first-admin' ),
		},
	],
	example: {
		numberOfPosts: 5,
		showExcerpts: true,
	},
};

export default widget;
