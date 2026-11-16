import type { FontSize } from '@typedpress-admin/global-styles-engine';
// @ts-expect-error - WordPress block-editor package doesn't have complete type definitions
import { getComputedFluidTypographyValue } from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';
import { useStyle } from '../hooks';

interface FontSizePreviewProps {
	fontSize: FontSize;
}

function FontSizePreview( { fontSize }: FontSizePreviewProps ) {
	const [ font ] = useStyle< { fontFamily?: string } >( 'typography' );

	const input =
		typeof fontSize?.fluid === 'object' &&
		fontSize?.fluid?.min &&
		fontSize?.fluid?.max
			? {
					minimumFontSize: fontSize.fluid.min,
					maximumFontSize: fontSize.fluid.max,
			  }
			: {
					fontSize: fontSize.size,
			  };

	const computedFontSize = getComputedFluidTypographyValue( input );
	return (
		<div
			className="typedpress-admin-typography-preview"
			style={ {
				fontSize: computedFontSize,
				fontFamily: font?.fontFamily ?? 'serif',
			} }
		>
			{ __( 'Aa', 'typedpress-admin' ) }
		</div>
	);
}

export default FontSizePreview;
