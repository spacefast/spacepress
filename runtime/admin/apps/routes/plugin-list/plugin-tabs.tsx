// eslint-disable-next-line @zero-admin/design-system/use-new-components -- See: ARC-1359
import { Tabs } from '@zero-admin/design-system';
import { __ } from '@wordpress/i18n';
import { pluginTabs } from './view-utils';
import type { PluginTab } from './view-utils';

type PluginTabsProps = {
	activeTab: PluginTab;
	onChange: ( tab: PluginTab ) => void;
};

/**
 * Renders the tabs strip for the Plugins page.
 *
 * The parent component (stage.tsx) owns the active tab state; we notify updates
 * via onChange. The DataViews content reacts to the selected tab by applying the
 * corresponding filters. *
 * @param {PluginTabsProps} props Component props.
 */
export const PluginTabs = ( { activeTab, onChange }: PluginTabsProps ) => {
	return (
		<Tabs.Root onValueChange={ onChange } value={ activeTab }>
			<Tabs.List density="compact">
				{ Array.from( pluginTabs.entries() ).map( ( [ key, data ] ) => (
					<Tabs.Tab value={ key } key={ key }>
						{ data.label }
					</Tabs.Tab>
				) ) }
			</Tabs.List>
		</Tabs.Root>
	);
};
