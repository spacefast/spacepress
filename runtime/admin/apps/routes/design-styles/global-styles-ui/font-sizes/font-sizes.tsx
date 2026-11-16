import { unlock } from '@typedpress-admin/admin-toolkit';
import type { FontSize } from '@typedpress-admin/global-styles-engine';
import { __, sprintf, isRTL } from '@wordpress/i18n';
import {
	privateApis as componentsPrivateApis,
	__experimentalSpacer as Spacer,
	__experimentalView as View,
	__experimentalItemGroup as ItemGroup,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	FlexItem,
	Button,
} from '@wordpress/components';
import {
	Icon,
	plus,
	moreVertical,
	chevronLeft,
	chevronRight,
} from '@wordpress/icons';
import { useState } from '@wordpress/element';
import { Subtitle } from '../subtitle';
import { NavigationButtonAsItem } from '../navigation-button';
import { getNewIndexFromPresets } from '../utils';
import { ScreenHeader } from '../screen-header';
import ConfirmResetFontSizesDialog from './confirm-reset-font-sizes-dialog';
import { useSetting } from '../hooks';

const { Menu } = unlock( componentsPrivateApis );

interface FontSizeGroupProps {
	label: string;
	origin: string;
	sizes: FontSize[];
	handleAddFontSize: () => void;
	handleResetFontSizes?: () => void;
}

function FontSizeGroup( {
	label,
	origin,
	sizes,
	handleAddFontSize,
	handleResetFontSizes,
}: FontSizeGroupProps ) {
	const [ isResetDialogOpen, setIsResetDialogOpen ] = useState( false );

	const toggleResetDialog = () => setIsResetDialogOpen( ! isResetDialogOpen );

	const resetDialogText =
		origin === 'custom'
			? __(
					'Are you sure you want to remove all custom font size presets?',
					'typedpress-admin'
			  )
			: __(
					'Are you sure you want to reset all font size presets to their default values?',
					'typedpress-admin'
			  );

	return (
		<>
			{ handleResetFontSizes && isResetDialogOpen && (
				<ConfirmResetFontSizesDialog
					text={ resetDialogText }
					confirmButtonText={
						origin === 'custom'
							? __( 'Remove', 'typedpress-admin' )
							: __( 'Reset', 'typedpress-admin' )
					}
					isOpen={ isResetDialogOpen }
					toggleOpen={ toggleResetDialog }
					onConfirm={ handleResetFontSizes }
				/>
			) }
			<VStack spacing={ 4 }>
				<HStack>
					<Subtitle level={ 3 }>{ label }</Subtitle>
					<FlexItem className="typedpress-admin-global-styles__typography-panel__options-container">
						{ origin === 'custom' && (
							<Button
								label={ __( 'Add font size', 'typedpress-admin' ) }
								icon={ plus }
								size="small"
								onClick={ handleAddFontSize }
							/>
						) }
						{ !! handleResetFontSizes && (
							<Menu>
								<Menu.TriggerButton
									render={
										<Button
											size="small"
											icon={ moreVertical }
											label={ __(
												'Font size presets options',
												'typedpress-admin'
											) }
										/>
									}
								/>
								<Menu.Popover>
									<Menu.Item onClick={ toggleResetDialog }>
										<Menu.ItemLabel>
											{ origin === 'custom'
												? __(
														'Remove font size presets',
														'typedpress-admin'
												  )
												: __(
														'Reset font size presets',
														'typedpress-admin'
												  ) }
										</Menu.ItemLabel>
									</Menu.Item>
								</Menu.Popover>
							</Menu>
						) }
					</FlexItem>
				</HStack>

				{ !! sizes.length && (
					<ItemGroup isBordered isSeparated>
						{ sizes.map( ( size ) => (
							<NavigationButtonAsItem
								key={ size.slug }
								path={ `/typography/font-sizes/${ origin }/${ size.slug }` }
							>
								<HStack>
									<FlexItem className="typedpress-admin-font-size__item">
										{ size.name }
									</FlexItem>
									<FlexItem display="flex">
										<Icon
											icon={
												isRTL()
													? chevronLeft
													: chevronRight
											}
										/>
									</FlexItem>
								</HStack>
							</NavigationButtonAsItem>
						) ) }
					</ItemGroup>
				) }
			</VStack>
		</>
	);
}

function FontSizes() {
	const [ themeFontSizes, setThemeFontSizes ] = useSetting(
		'typography.fontSizes.theme'
	);

	const [ baseThemeFontSizes ] = useSetting(
		'typography.fontSizes.theme',
		'base'
	);
	const [ defaultFontSizes, setDefaultFontSizes ] = useSetting(
		'typography.fontSizes.default'
	);

	const [ baseDefaultFontSizes ] = useSetting(
		'typography.fontSizes.default',
		'base'
	);

	const [ customFontSizes = [], setCustomFontSizes ] = useSetting(
		'typography.fontSizes.custom'
	);

	const [ defaultFontSizesEnabled ] = useSetting(
		'typography.defaultFontSizes'
	);

	const handleAddFontSize = () => {
		const index = getNewIndexFromPresets( customFontSizes, 'custom-' );
		const newFontSize = {
			/* translators: %d: font size index */
			name: sprintf( __( 'New Font Size %d', 'typedpress-admin' ), index ),
			size: '16px',
			slug: `custom-${ index }`,
		};

		setCustomFontSizes( [ ...customFontSizes, newFontSize ] );
	};

	const hasSameSizeValues = ( arr1: FontSize[], arr2: FontSize[] ): boolean =>
		arr1.map( ( item ) => item.size ).join( '' ) ===
		arr2.map( ( item ) => item.size ).join( '' );

	return (
		<VStack spacing={ 2 }>
			<ScreenHeader
				title={ __( 'Font size presets', 'typedpress-admin' ) }
				description={ __(
					'Create and edit the presets used for font sizes across the site.',
					'typedpress-admin'
				) }
			/>

			<View>
				<Spacer paddingX={ 4 }>
					<VStack spacing={ 8 }>
						{ !! themeFontSizes?.length && (
							<FontSizeGroup
								label={ __( 'Theme', 'typedpress-admin' ) }
								origin="theme"
								sizes={ themeFontSizes }
								handleAddFontSize={ handleAddFontSize }
								handleResetFontSizes={
									hasSameSizeValues(
										themeFontSizes,
										baseThemeFontSizes
									)
										? undefined
										: () =>
												setThemeFontSizes(
													baseThemeFontSizes
												)
								}
							/>
						) }

						{ defaultFontSizesEnabled &&
							!! defaultFontSizes?.length && (
								<FontSizeGroup
									label={ __( 'Default', 'typedpress-admin' ) }
									origin="default"
									sizes={ defaultFontSizes }
									handleAddFontSize={ handleAddFontSize }
									handleResetFontSizes={
										hasSameSizeValues(
											defaultFontSizes,
											baseDefaultFontSizes
										)
											? undefined
											: () =>
													setDefaultFontSizes(
														baseDefaultFontSizes
													)
									}
								/>
							) }

						<FontSizeGroup
							label={ __( 'Custom', 'typedpress-admin' ) }
							origin="custom"
							sizes={ customFontSizes }
							handleAddFontSize={ handleAddFontSize }
							handleResetFontSizes={
								customFontSizes.length > 0
									? () => setCustomFontSizes( [] )
									: undefined
							}
						/>
					</VStack>
				</Spacer>
			</View>
		</VStack>
	);
}

export default FontSizes;
