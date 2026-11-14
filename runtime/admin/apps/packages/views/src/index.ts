// View state for First Admin's lists: @wordpress/views, with First's own view-config hook (First
// Admin's fields: tabs, quick and add forms, labels, actions) and its DataViews layout wrapper.
import { useMemo } from '@wordpress/element';
import {
	useView as useUpstreamView,
	loadView as loadUpstreamView,
} from '@wordpress/views';
import type { View } from '@first-admin/dataviews';

type Config = Parameters< typeof useUpstreamView >[ 0 ];
type Overrides = Config[ 'activeViewOverrides' ];

/**
 * A tab's filters (a role on Users, a status on Posts) hold whatever the user saved for that
 * tab: they are the tab. @wordpress/views keeps filters passed as locked `activeViewOverrides`
 * on top of the saved view, as Gutenberg's own lists pass theirs.
 */
function tabOverrides( defaultView: Config[ 'defaultView' ], given: Overrides ): Overrides {
	const filters = ( defaultView as View ).filters ?? [];
	if ( filters.length === 0 || given?.filters ) {
		return given;
	}
	return {
		...given,
		filters: filters.map( ( filter ) => ( { ...filter, isLocked: true } ) ),
	};
}

export function useView( config: Config ) {
	// Kept stable per default view: @wordpress/views recomputes the view when the overrides change.
	const activeViewOverrides = useMemo(
		() => tabOverrides( config.defaultView, config.activeViewOverrides ),
		[ config.defaultView, config.activeViewOverrides ]
	);
	return useUpstreamView( { ...config, activeViewOverrides } );
}

export function loadView( config: Config ) {
	return loadUpstreamView( {
		...config,
		activeViewOverrides: tabOverrides( config.defaultView, config.activeViewOverrides ),
	} );
}

export { useViewConfig } from './use-view-config';
export { DataViews } from './dataviews';
