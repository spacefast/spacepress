import { SelectControl } from '@first-admin/design-system';
import { useCallback, useMemo } from '@wordpress/element';
import { __, _x } from '@wordpress/i18n';
import type { AspectRatioComponentProps, AspectRatio } from './types';

const EMPTY_ARRAY: AspectRatio[] | [] = [];

export default function AspectRatioSelect( {
	onChange,
	aspectRatio,
	imageAspectRatios = EMPTY_ARRAY,
	defaultRatios = EMPTY_ARRAY,
	themeRatios = EMPTY_ARRAY,
}: AspectRatioComponentProps ) {
	const allRatios = useMemo(
		() => [ ...imageAspectRatios, ...defaultRatios, ...themeRatios ],
		[ imageAspectRatios, defaultRatios, themeRatios ]
	);

	const aspectRatioOptions = useMemo(
		() =>
			allRatios.map( ( { name, slug } ) => ( {
				label: name,
				value: slug,
			} ) ),
		[ allRatios ]
	);

	const handleChange = useCallback(
		( value: string ) => {
			const ratio = allRatios.find(
				( { slug: _slug } ) => _slug === value
			);
			if ( ratio ) {
				onChange( ratio );
			}
		},
		[ allRatios, onChange ]
	);

	return (
		<SelectControl
			label={ __( 'Aspect ratio', 'first-admin' ) }
			value={ aspectRatio?.slug }
			items={ aspectRatioOptions }
			// @ts-expect-error TODO: Value can be null.
			onValueChange={ handleChange }
		/>
	);
}
