import { __ } from '@wordpress/i18n';
import { privateApis as componentsPrivateApis } from '@wordpress/components';
import { unlock } from '@spacepress-admin/admin-toolkit';
import { ScreenHeader } from './screen-header';
import ColorPalettePanel from './color-palette-panel';
import GradientPalettePanel from './gradients-palette-panel';

const { Tabs } = unlock( componentsPrivateApis );

function ScreenColorPalette( { name }: { name?: string } ) {
	return (
		<>
			<ScreenHeader
				title={ __( 'Edit palette', 'spacepress-admin' ) }
				description={ __(
					'The combination of colors used across the site and in color pickers.',
					'spacepress-admin'
				) }
			/>
			<Tabs>
				<Tabs.TabList>
					<Tabs.Tab tabId="color">
						{ __( 'Color', 'spacepress-admin' ) }
					</Tabs.Tab>
					<Tabs.Tab tabId="gradient">
						{ __( 'Gradient', 'spacepress-admin' ) }
					</Tabs.Tab>
				</Tabs.TabList>
				<Tabs.TabPanel tabId="color" focusable={ false }>
					<ColorPalettePanel name={ name } />
				</Tabs.TabPanel>
				<Tabs.TabPanel tabId="gradient" focusable={ false }>
					<GradientPalettePanel name={ name } />
				</Tabs.TabPanel>
			</Tabs>
		</>
	);
}

export default ScreenColorPalette;
