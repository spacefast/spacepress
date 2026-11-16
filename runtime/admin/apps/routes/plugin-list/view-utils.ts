import { __ } from '@wordpress/i18n';
import type { View } from '@typedpress-admin/dataviews';

const DEFAULT_TABLE_FIELDS = [
	'status',
	'version',
	'author',
	'auto_update',
	'update_available',
];

const DEFAULT_PLUGIN_VIEW: View = {
	type: 'table',
	perPage: 20,
	sort: { field: 'name', direction: 'asc' },
	filters: [],
	titleField: 'name',
	fields: DEFAULT_TABLE_FIELDS,
	descriptionField: 'description',
	showDescription: true,
};

/**
 * Get the default view configuration for plugins based on the current tab.
 *
 * @return The default view configuration
 */
export function getDefaultView(): View {
	return DEFAULT_PLUGIN_VIEW;
}

/**
 * Tab identifiers used by the Tabs component and as keys in the pluginTabs map.
 *
 * Note: Some values (active/inactive) directly map to the REST "status" param,
 * while others (recently-active, update-available, auto-updates-*) are used to
 * derive other REST params or client-side filters. See stage.tsx for details.
 */
export enum PluginTab {
	ALL = 'all',
	ACTIVE = 'active',
	INACTIVE = 'inactive',
	RECENTLY_ACTIVE = 'recently-active',
	UPDATE_AVAILABLE = 'update-available',
	AUTO_UPDATES_ENABLED = 'auto-updates-enabled',
	AUTO_UPDATES_DISABLED = 'auto-updates-disabled',
}

/**
 * Metadata describing a tab.
 *
 * - label: Localized label shown in the UI.
 * - filterBy (optional): The REST/field key used to filter when that tab is selected.
 *   • 'status' affects REST collection param `status` (only for Active/Inactive).
 *   • 'recently_active', 'update_available', 'auto_update' are boolean fields the
 *     REST controller exposes and that can be used to filter the collection.
 * - filterValue (optional): The value to use with filterBy (e.g., 'active', true).
 */
type PluginTabData = {
	tab: PluginTab;
	label: string;
	filterBy?:
		| 'status'
		| 'recently_active'
		| 'update_available'
		| 'auto_update';
	filterValue?: string | boolean;
};

// Map each tab to its data object (label + optional filtering key/value).
// This map is consumed by the tabs UI below, and by stage.tsx to build queries.
export const pluginTabs = new Map< PluginTab, PluginTabData >( [
	[ PluginTab.ALL, { tab: PluginTab.ALL, label: __( 'All', 'typedpress-admin' ) } ],
	[
		PluginTab.ACTIVE,
		{
			tab: PluginTab.ACTIVE,
			label: __( 'Active', 'typedpress-admin' ),
			filterBy: 'status',
			filterValue: 'active',
		},
	],
	[
		PluginTab.INACTIVE,
		{
			tab: PluginTab.INACTIVE,
			label: __( 'Inactive', 'typedpress-admin' ),
			filterBy: 'status',
			filterValue: 'inactive',
		},
	],
	[
		PluginTab.RECENTLY_ACTIVE,
		{
			tab: PluginTab.RECENTLY_ACTIVE,
			label: __( 'Recently Active', 'typedpress-admin' ),
			filterBy: 'recently_active',
			filterValue: true,
		},
	],
	[
		PluginTab.UPDATE_AVAILABLE,
		{
			tab: PluginTab.UPDATE_AVAILABLE,
			label: __( 'Update Available', 'typedpress-admin' ),
			filterBy: 'update_available',
			filterValue: true,
		},
	],
	[
		PluginTab.AUTO_UPDATES_ENABLED,
		{
			tab: PluginTab.AUTO_UPDATES_ENABLED,
			label: __( 'Auto-Updates Enabled', 'typedpress-admin' ),
			filterBy: 'auto_update',
			filterValue: true,
		},
	],
	[
		PluginTab.AUTO_UPDATES_DISABLED,
		{
			tab: PluginTab.AUTO_UPDATES_DISABLED,
			label: __( 'Auto-Updates Disabled', 'typedpress-admin' ),
			filterBy: 'auto_update',
			filterValue: false,
		},
	],
] );

/**
 * Build plugin query based on the active tab.
 * @param slug The active tab slug.
 * @return Query object for fetching plugins.
 */
export function viewToQuery( slug: string ) {
	const query: Record< string, any > = { per_page: -1 };
	const tabData = pluginTabs.get( slug as PluginTab );
	if (
		tabData?.filterBy !== undefined &&
		tabData?.filterValue !== undefined
	) {
		// Use the active tab's filter key/value when available
		query[ tabData.filterBy ] = tabData.filterValue;
	}
	return query;
}
