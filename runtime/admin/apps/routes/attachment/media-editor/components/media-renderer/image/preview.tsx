export default function ImagePreview( {
	sourceUrl,
	altText,
}: {
	sourceUrl: string;
	altText: string;
} ) {
	return (
		<img
			className="zero-admin-media-editor-content__image"
			src={ sourceUrl }
			alt={ altText }
		/>
	);
}
