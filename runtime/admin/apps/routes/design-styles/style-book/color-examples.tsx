import clsx from 'clsx';
import { __experimentalGrid as Grid } from '@wordpress/components';
import {
	getColorClassName,
	__experimentalGetGradientClass,
	// @ts-expect-error - WordPress block editor module doesn't have proper types
} from '@wordpress/block-editor';
import type { Color, Gradient } from '@spacepress-admin/global-styles-engine';

interface ColorExampleProps {
	colors: Color[] | Gradient[];
	type: 'colors' | 'gradients';
	templateColumns?: string;
	itemHeight?: string;
}

const ColorExamples = ( {
	colors,
	type,
	templateColumns = '1fr 1fr',
	itemHeight = '52px',
}: ColorExampleProps ): JSX.Element | null => {
	if ( ! colors ) {
		return null;
	}

	return (
		<Grid templateColumns={ templateColumns } rowGap={ 8 } columnGap={ 16 }>
			{ colors.map( ( color: Color | Gradient ) => {
				const className =
					type === 'gradients'
						? __experimentalGetGradientClass( color.slug )
						: getColorClassName( 'background-color', color.slug );
				const classes = clsx(
					'spacepress-admin-style-book__color-example',
					className
				);

				return (
					<div
						key={ color.slug }
						className={ classes }
						style={ { height: itemHeight } }
					/>
				);
			} ) }
		</Grid>
	);
};

export default ColorExamples;
