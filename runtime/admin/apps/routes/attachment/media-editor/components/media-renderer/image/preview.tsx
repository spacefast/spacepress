import { useImageCropper } from '@spacepress-admin/image-cropper';
import { useEffect, useState } from '@wordpress/element';

export default function ImagePreview( {
	sourceUrl,
	altText,
}: {
	sourceUrl: string;
	altText: string;
} ) {
	const { getCroppedImage, isDirty: isImageDirty } = useImageCropper();
	const [ displayUrl, setDisplayUrl ] = useState< string | null >( null );
	const [ isLoading, setIsLoading ] = useState( false );

	useEffect( () => {
		if ( isImageDirty ) {
			setIsLoading( true );
			setDisplayUrl( null ); // Clear the display URL to prevent showing original.

			getCroppedImage( sourceUrl ).then( ( croppedImage ) => {
				if ( croppedImage ) {
					setDisplayUrl( croppedImage );
				}
				setIsLoading( false );
			} );
		} else {
			setDisplayUrl( sourceUrl );
			setIsLoading( false );
		}
	}, [ isImageDirty, sourceUrl, getCroppedImage ] );

	// Don't render the image if we're loading a cropped version
	if ( isLoading || ( isImageDirty && ! displayUrl ) ) {
		return null; // Or a loading spinner/placeholder.
	}

	return (
		<img
			className="spacepress-admin-media-editor-content__image"
			src={ displayUrl || sourceUrl }
			alt={ altText }
		/>
	);
}
