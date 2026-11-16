import { __ } from '@wordpress/i18n';

export default function FrontEndPreview( { url }: { url: string } ) {
	// Add na_site_preview parameter to hide admin bar
	// `window.origin` also holds in the Content frame, where location is about:srcdoc.
	const previewUrl = new URL( url, window.origin );
	previewUrl.searchParams.set( 'na_site_preview', '1' );

	return (
		<iframe
			src={ previewUrl.toString() }
			title={ __( 'Site Preview', 'typedpress-admin' ) }
			style={ {
				display: 'block',
				border: 'none',
				width: '100%',
				height: '100%',
				backgroundColor: '#fff',
			} }
		/>
	);
}
