import { useImageCropper, type Flip } from '@spacepress-admin/image-cropper';
import { useEffect, useCallback } from '@wordpress/element';
import useGetAspectRatios from '../../../../hooks/use-get-aspect-ratios';
import { ratioToNumber, type AspectRatio } from './aspect-ratio';
import { isQuarterTurn } from './utils';
import { useMediaEditorState } from '../../../../provider/with-media-editor-state-provider';

/**
 * Custom hook that encapsulates shared editing tools logic
 * Used by both toolbar and panel components
 */
export default function useEditingTools() {
	const { cropperState, setCropperState, reset } = useImageCropper();

	const {
		default: defaultRatios,
		theme: themeRatios,
		imageAspectRatios,
	} = useGetAspectRatios();

	const { selectedAspectRatio, setSelectedAspectRatio } =
		useMediaEditorState();

	useEffect( () => {
		setSelectedAspectRatio( imageAspectRatios[ 0 ] );
	}, [ imageAspectRatios, setSelectedAspectRatio ] );

	/*
	 * If the image is rotated 90° or 270° and the aspect ratio is the default image aspect ratio,
	 * the aspect ratio needs to be recalculated to update the crop area.
	 */
	const maybeFlipAspectRatio = useCallback(
		( updatedRotation: number ) => {
			let newAspectRatio = cropperState.aspectRatio;
			const original = cropperState.mediaSize?.naturalWidth
				? cropperState.mediaSize.naturalWidth /
				  cropperState.mediaSize.naturalHeight
				: 1;
			const rotated = cropperState.mediaSize?.naturalHeight
				? cropperState.mediaSize.naturalHeight /
				  cropperState.mediaSize.naturalWidth
				: 1;
			/*
			 * Rotate the crop area with the image when the image aspect ratio is active,
			 * and the user has not changed the zoom level.
			 *
			 * To rotate the crop area with the image,
			 * the aspect ratio needs to be recalculated to update the crop area.
			 */
			if (
				cropperState.zoom === 1 &&
				selectedAspectRatio?.slug === imageAspectRatios[ 0 ]?.slug &&
				( cropperState.aspectRatio === original ||
					cropperState.aspectRatio === rotated )
			) {
				/*
				 * If the image is rotated 90° or 270°,
				 * the aspect ratio needs to be recalculated to
				 * update the crop area.
				 *
				 * If the image is 0° or 180° rotated, set
				 * the aspect ratio to the default image aspect ratio.
				 */
				newAspectRatio = isQuarterTurn( updatedRotation )
					? rotated
					: original;
			}
			if ( newAspectRatio !== cropperState.aspectRatio ) {
				setCropperState( { aspectRatio: newAspectRatio } );
			}
		},
		[
			cropperState,
			selectedAspectRatio,
			imageAspectRatios,
			setCropperState,
		]
	);

	const handleSetRotation = useCallback(
		( newRotation: number ) => {
			setCropperState( { rotation: newRotation } );
			maybeFlipAspectRatio( newRotation );
		},
		[ setCropperState, maybeFlipAspectRatio ]
	);

	const handleSetAspectRatio = useCallback(
		( newAspectRatio: AspectRatio ) => {
			setCropperState( {
				aspectRatio: ratioToNumber( newAspectRatio.ratio ),
			} );
			setSelectedAspectRatio( newAspectRatio );
		},
		[ setCropperState, setSelectedAspectRatio ]
	);

	const handleSetFlip = useCallback(
		( newFlip: Flip ) => {
			setCropperState( ( prev ) => ( {
				flip: newFlip,
				rotation: 360 - prev.rotation,
			} ) );
		},
		[ setCropperState ]
	);

	const handleReset = useCallback( () => {
		setSelectedAspectRatio( imageAspectRatios[ 0 ] ?? null );
		reset();
	}, [ setSelectedAspectRatio, imageAspectRatios, reset ] );

	return {
		// Core cropper state and actions (unified)
		cropperState,
		setCropperState,
		// Aspect ratio UI state
		selectedAspectRatio,
		setSelectedAspectRatio,
		// Aspect ratio data
		defaultRatios,
		themeRatios,
		imageAspectRatios,
		// Smart handlers that manage multiple state updates
		handleSetRotation,
		handleSetAspectRatio,
		handleSetFlip,
		handleReset,
	};
}
