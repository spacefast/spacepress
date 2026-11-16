import { __experimentalItemGroup as ItemGroup } from '@wordpress/components';
import {
	background,
	typography,
	color,
	layout,
	shadow as shadowIcon,
} from '@wordpress/icons';
import { __ } from '@wordpress/i18n';
// @ts-expect-error - WordPress private APIs
import { privateApis as blockEditorPrivateApis } from '@wordpress/block-editor';
import type { GlobalStylesSettings } from '@typedpress-admin/global-styles-engine';
import { unlock } from '@typedpress-admin/admin-toolkit';
import { NavigationButtonAsItem } from './navigation-button';
import { useSetting } from './hooks';

const {
	useHasDimensionsPanel,
	useHasTypographyPanel,
	useHasColorPanel,
	useSettingsForBlockElement,
	useHasBackgroundPanel,
} = unlock( blockEditorPrivateApis );

function RootMenu() {
	// Get the raw settings from our custom hook
	const [ rawSettings ] = useSetting< GlobalStylesSettings >( '' );

	// Process settings the same way as Gutenberg
	const settings = useSettingsForBlockElement( rawSettings );

	// Use the same panel detection logic as Gutenberg
	const hasBackgroundPanel = useHasBackgroundPanel( rawSettings );
	const hasTypographyPanel = useHasTypographyPanel( settings );
	const hasColorPanel = useHasColorPanel( settings );
	const hasShadowPanel = true; // Same as Gutenberg
	const hasDimensionsPanel = useHasDimensionsPanel( settings );
	const hasLayoutPanel = hasDimensionsPanel;

	return (
		<>
			<ItemGroup>
				{ hasTypographyPanel && (
					<NavigationButtonAsItem
						icon={ typography }
						path="/typography"
					>
						{ __( 'Typography', 'typedpress-admin' ) }
					</NavigationButtonAsItem>
				) }
				{ hasColorPanel && (
					<NavigationButtonAsItem icon={ color } path="/colors">
						{ __( 'Colors', 'typedpress-admin' ) }
					</NavigationButtonAsItem>
				) }
				{ hasBackgroundPanel && (
					<NavigationButtonAsItem
						icon={ background }
						path="/background"
						aria-label={ __( 'Background styles', 'typedpress-admin' ) }
					>
						{ __( 'Background', 'typedpress-admin' ) }
					</NavigationButtonAsItem>
				) }
				{ hasShadowPanel && (
					<NavigationButtonAsItem icon={ shadowIcon } path="/shadows">
						{ __( 'Shadows', 'typedpress-admin' ) }
					</NavigationButtonAsItem>
				) }
				{ hasLayoutPanel && (
					<NavigationButtonAsItem icon={ layout } path="/layout">
						{ __( 'Layout', 'typedpress-admin' ) }
					</NavigationButtonAsItem>
				) }
			</ItemGroup>
		</>
	);
}

export default RootMenu;
