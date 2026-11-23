import { Button, IconButton } from '@wordpress/ui';
// eslint-disable-next-line @spacepress-admin/design-system/use-new-components -- See: ARC-1359
import { Stack } from '@spacepress-admin/design-system';
import { __ } from '@wordpress/i18n';
import {
	flipHorizontal as flipHorizontalIcon,
	flipVertical as flipVerticalIcon,
	rotateRight as rotateRightIcon,
	rotateLeft as rotateLeftIcon,
} from '@wordpress/icons';
import ZoomDropdown from './zoom/dropdown';
import { AspectRatioDropdown } from './aspect-ratio';
import useEditingTools from './use-editing-tools';

export default function EditingToolsToolbar() {
	const {
		cropperState,
		setCropperState,
		selectedAspectRatio,
		defaultRatios,
		themeRatios,
		imageAspectRatios,
		handleSetRotation,
		handleSetAspectRatio,
		handleSetFlip,
		handleReset,
	} = useEditingTools();

	// Extract individual values for easier access in the UI
	const { zoom, rotation, flip } = cropperState;

	return (
		<Stack
			direction="row"
			gap={ 2 }
			className="spacepress-admin-media-editor__toolbar"
			id="spacepress-admin-media-editor-toolbar"
		>
			<ZoomDropdown
				label={ __( 'Zoom', 'spacepress-admin' ) }
				zoom={ zoom }
				onChange={ ( newZoom ) => setCropperState( { zoom: newZoom } ) }
			/>
			<AspectRatioDropdown
				className="spacepress-admin-media-editor__tools-panel-dropdown"
				aspectRatio={ selectedAspectRatio }
				onChange={ handleSetAspectRatio }
				imageAspectRatios={ imageAspectRatios }
				defaultRatios={ defaultRatios }
				themeRatios={ themeRatios }
			/>
			<IconButton
				variant="minimal"
				tone="neutral"
				label={ __( 'Flip horizontal', 'spacepress-admin' ) }
				icon={ flipHorizontalIcon }
				onClick={ () =>
					handleSetFlip( {
						vertical: flip.vertical,
						horizontal: ! flip.horizontal,
					} )
				}
			/>
			<IconButton
				variant="minimal"
				tone="neutral"
				label={ __( 'Flip vertical', 'spacepress-admin' ) }
				icon={ flipVerticalIcon }
				onClick={ () =>
					handleSetFlip( {
						vertical: ! flip.vertical,
						horizontal: flip.horizontal,
					} )
				}
			/>
			<IconButton
				variant="minimal"
				tone="neutral"
				icon={ rotateLeftIcon }
				onClick={ () => handleSetRotation( rotation - 90 ) }
				label={ __( 'Rotate 90° left', 'spacepress-admin' ) }
			/>
			<IconButton
				variant="minimal"
				tone="neutral"
				icon={ rotateRightIcon }
				label={ __( 'Rotate 90° right', 'spacepress-admin' ) }
				onClick={ () => handleSetRotation( rotation + 90 ) }
			/>
			<Button variant="minimal" tone="neutral" onClick={ handleReset }>
				{ __( 'Reset', 'spacepress-admin' ) }
			</Button>
		</Stack>
	);
}
