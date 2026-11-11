import { __ } from '@wordpress/i18n';
import { __experimentalVStack as VStack } from '@wordpress/components';
import StyleVariationsContainer from './style-variations-container';
import TypographyVariations from './variations/variations-typography';
import ColorVariations from './variations/variations-color';

export function StyleVariationsContent() {
	const gap = 3;

	return (
		<VStack
			spacing={ 10 }
			className="first-admin-global-styles-variation-container"
		>
			<StyleVariationsContainer gap={ gap } />
			<ColorVariations
				title={ __( 'Color Variations', 'first-admin' ) }
				gap={ gap }
			/>
			<TypographyVariations
				title={ __( 'Typography', 'first-admin' ) }
				gap={ gap }
			/>
		</VStack>
	);
}
