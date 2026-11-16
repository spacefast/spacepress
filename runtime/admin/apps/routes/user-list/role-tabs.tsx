import { __ } from '@wordpress/i18n';
import { useSelect } from '@wordpress/data';
// eslint-disable-next-line @typedpress-admin/design-system/use-new-components -- See: ARC-1359
import { Tabs } from '@typedpress-admin/design-system';
import { store as coreDataNextStore } from '@typedpress-admin/core-data-next';

export const RoleTabs = ( {
	onChange,
	value,
}: {
	onChange: ( role: string ) => void;
	value?: string;
} ) => {
	const viewConfig = useSelect( ( select ) => {
		const { getEntityViewConfig } = select( coreDataNextStore );
		return getEntityViewConfig( 'root', 'user' );
	}, [] );

	// Use tabs from PHP config
	const roleTabs =
		viewConfig?.tabs?.map( ( tab: { label: string; slug: string } ) => ( {
			label: tab.label,
			value: tab.slug,
		} ) ) || [];

	return (
		<Tabs.Root
			onValueChange={ onChange }
			value={ value ?? roleTabs[ 0 ].value }
		>
			<Tabs.List density="compact">
				{ roleTabs.map(
					( tabItem: { label: string; value: string } ) => (
						<Tabs.Tab value={ tabItem.value } key={ tabItem.label }>
							{ tabItem.label }
						</Tabs.Tab>
					)
				) }
			</Tabs.List>
		</Tabs.Root>
	);
};
