// eslint-disable-next-line @first-admin/design-system/use-new-components -- See: ARC-1359
import { Stack } from '@first-admin/design-system';
import { useImageCropper } from '@first-admin/image-cropper';
import { __ } from '@wordpress/i18n';
import {
	__experimentalHeading as Heading,
	__experimentalToolsPanel as ToolsPanel,
	__experimentalToolsPanelItem as ToolsPanelItem,
	Button,
} from '@wordpress/components';
import { useCallback } from '@wordpress/element';
import {
	flipHorizontal as flipHorizontalIcon,
	flipVertical as flipVerticalIcon,
	rotateRight as rotateRightIcon,
	rotateLeft as rotateLeftIcon,
} from '@wordpress/icons';
import ZoomRange from './zoom/range';
import { AspectRatioSelect } from './aspect-ratio';
import useEditingTools from './use-editing-tools';
import './style.scss';

export default function EditingToolsPanel() {
	const { resetState } = useImageCropper();

	const {
		cropperState,
		setCropperState,
		selectedAspectRatio,
		setSelectedAspectRatio,
		defaultRatios,
		themeRatios,
		imageAspectRatios,
		handleSetRotation,
		handleSetAspectRatio,
		handleSetFlip,
		handleReset,
	} = useEditingTools();

	// Extract individual values for easier access in the UI
	const { zoom, rotation, aspectRatio, flip } = cropperState;

	const resetPositionTools = useCallback( () => {
		setCropperState( {
			flip: resetState?.flip ?? {
				horizontal: false,
				vertical: false,
			},
			rotation: resetState?.rotation ?? 0,
		} );
	}, [ resetState, setCropperState ] );

	if ( ! selectedAspectRatio ) {
		return null;
	}

	return (
		<div className="first-admin-media-editor__tools-panel">
			<ToolsPanel
				label={ __( 'Crop area', 'first-admin' ) }
				resetAll={ () => {
					setCropperState( {
						zoom: resetState?.zoom ?? 1,
						aspectRatio: resetState?.aspectRatio ?? 1,
					} );
					setSelectedAspectRatio( imageAspectRatios[ 0 ] ?? null );
				} }
				panelId={ 'crop-area' }
			>
				<ToolsPanelItem
					hasValue={ () => zoom !== ( resetState?.zoom ?? 1 ) }
					label={ __( 'Zoom', 'first-admin' ) }
					onDeselect={ () =>
						setCropperState( { zoom: resetState?.zoom ?? 1 } )
					}
					isShownByDefault
					panelId={ 'crop-area' }
				>
					<ZoomRange
						label={ __( 'Zoom', 'first-admin' ) }
						zoom={ zoom }
						onChange={ ( newZoom ) =>
							setCropperState( { zoom: newZoom } )
						}
					/>
				</ToolsPanelItem>
				<ToolsPanelItem
					hasValue={ () =>
						aspectRatio !== ( resetState?.aspectRatio ?? 1 )
					}
					label={ __( 'Aspect ratio', 'first-admin' ) }
					onDeselect={ () => {
						setCropperState( {
							aspectRatio: resetState?.aspectRatio ?? 1,
						} );
						setSelectedAspectRatio(
							imageAspectRatios[ 0 ] ?? null
						);
					} }
					isShownByDefault
					panelId={ 'crop-area' }
				>
					<AspectRatioSelect
						className="first-admin-media-editor__tools-panel-dropdown"
						aspectRatio={ selectedAspectRatio }
						onChange={ handleSetAspectRatio }
						imageAspectRatios={ imageAspectRatios }
						defaultRatios={ defaultRatios }
						themeRatios={ themeRatios }
						displayAspectRatioName={ true }
					/>
				</ToolsPanelItem>
			</ToolsPanel>
			<ToolsPanel
				label={ __( 'Position', 'first-admin' ) }
				resetAll={ resetPositionTools }
				panelId={ 'position' }
			>
				<ToolsPanelItem
					hasValue={ () =>
						rotation !== ( resetState?.rotation ?? 0 )
					}
					label={ __( 'Rotate', 'first-admin' ) }
					onDeselect={ () => {
						const updates: any = {
							rotation: resetState?.rotation ?? 0,
						};
						if ( 1 === zoom ) {
							updates.aspectRatio = resetState?.aspectRatio ?? 1;
						}
						setCropperState( updates );
					} }
					isShownByDefault
					panelId={ 'position' }
				>
					<Heading
						upperCase
						level={ 3 }
						size={ 11 }
						className="first-admin-media-editor__tools-panel-heading"
					>
						{ __( 'Rotate', 'first-admin' ) }
					</Heading>
					<Stack direction="row" justify="space-between" gap={ 2 }>
						<Button
							className="first-admin-media-editor__tools-panel-button"
							variant="secondary"
							icon={ rotateLeftIcon }
							label={ __( 'Rotate 90° left', 'first-admin' ) }
							onClick={ () => handleSetRotation( rotation - 90 ) }
						>
							{ __( '90° left', 'first-admin' ) }
						</Button>
						<Button
							className="first-admin-media-editor__tools-panel-button"
							variant="secondary"
							icon={ rotateRightIcon }
							label={ __( 'Rotate 90° right', 'first-admin' ) }
							onClick={ () => handleSetRotation( rotation + 90 ) }
						>
							{ __( '90° right', 'first-admin' ) }
						</Button>
					</Stack>
				</ToolsPanelItem>
				<ToolsPanelItem
					hasValue={ () => {
						const defaultFlip = {
							horizontal: false,
							vertical: false,
						};
						const resetFlip = resetState?.flip ?? defaultFlip;
						return (
							flip.horizontal !== resetFlip.horizontal ||
							flip.vertical !== resetFlip.vertical
						);
					} }
					label={ __( 'Flip', 'first-admin' ) }
					onDeselect={ () =>
						setCropperState( {
							flip: resetState?.flip ?? {
								horizontal: false,
								vertical: false,
							},
						} )
					}
					isShownByDefault
					panelId={ 'position' }
				>
					<Heading
						upperCase
						level={ 3 }
						size={ 11 }
						className="first-admin-media-editor__tools-panel-heading"
					>
						{ __( 'Flip', 'first-admin' ) }
					</Heading>
					<Stack direction="row" justify="space-between" gap={ 2 }>
						<Button
							className="first-admin-media-editor__tools-panel-button"
							variant="secondary"
							icon={ flipHorizontalIcon }
							label={ __( 'Flip horizontal', 'first-admin' ) }
							onClick={ () =>
								handleSetFlip( {
									vertical: flip.vertical,
									horizontal: ! flip.horizontal,
								} )
							}
						>
							{ __( 'Horizontal', 'first-admin' ) }
						</Button>
						<Button
							variant="secondary"
							className="first-admin-media-editor__tools-panel-button"
							icon={ flipVerticalIcon }
							label={ __( 'Flip vertical', 'first-admin' ) }
							onClick={ () =>
								handleSetFlip( {
									vertical: ! flip.vertical,
									horizontal: flip.horizontal,
								} )
							}
						>
							{ __( 'Vertical', 'first-admin' ) }
						</Button>
					</Stack>
				</ToolsPanelItem>
			</ToolsPanel>
			<Stack
				direction="row"
				justify="end"
				gap={ 4 }
				className="first-admin-media-editor__tools-panel-row"
			>
				<Button
					className="first-admin-media-editor__tools-panel-button"
					variant="secondary"
					isDestructive
					onClick={ handleReset }
				>
					{ __( 'Reset all', 'first-admin' ) }
				</Button>
			</Stack>
		</div>
	);
}
