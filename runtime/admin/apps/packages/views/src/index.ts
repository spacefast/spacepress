// View state for First Admin's lists: @wordpress/views, with First's own view-config hook (First
// Admin's fields: tabs, quick and add forms, labels, actions) and its DataViews layout wrapper.
import {
	useView as useUpstreamView,
	loadView as loadUpstreamView,
} from '@wordpress/views';
import type { View } from '@first-admin/dataviews';

type Config = Parameters< typeof useUpstreamView >[ 0 ];

/**
 * A tab's filters (a role on Users, a status on Posts) hold whatever the user saved for that
 * tab: they are the tab. @wordpress/views keeps filters passed as locked `activeViewOverrides`
 * on top of the saved view, as Gutenberg's own lists pass theirs.
 */
function withTabFilters( config: Config ): Config {
	const filters = ( config.defaultView as View ).filters ?? [];
	if ( filters.length === 0 || config.activeViewOverrides?.filters ) {
		return config;
	}
	return {
		...config,
		activeViewOverrides: {
			...config.activeViewOverrides,
			filters: filters.map( ( filter ) => ( { ...filter, isLocked: true } ) ),
		},
	};
}

export function useView( config: Config ) {
	return useUpstreamView( withTabFilters( config ) );
}

export function loadView( config: Config ) {
	return loadUpstreamView( withTabFilters( config ) );
}

export { useViewConfig } from './use-view-config';
export { DataViews } from './dataviews';
