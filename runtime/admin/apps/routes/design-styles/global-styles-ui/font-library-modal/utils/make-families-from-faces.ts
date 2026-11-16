import { unlock } from '@typedpress-admin/admin-toolkit';
import { privateApis as componentsPrivateApis } from '@wordpress/components';
import type { FontFamily, FontFace } from '../types';

const { kebabCase } = unlock( componentsPrivateApis );

export default function makeFamiliesFromFaces(
	fontFaces: FontFace[]
): FontFamily[] {
	const fontFamiliesObject = fontFaces.reduce(
		( acc: Record< string, FontFamily >, item: FontFace ) => {
			if ( ! acc[ item.fontFamily ] ) {
				acc[ item.fontFamily ] = {
					name: item.fontFamily,
					fontFamily: item.fontFamily,
					slug: kebabCase( item.fontFamily.toLowerCase() ),
					fontFace: [],
				};
			}
			acc[ item.fontFamily ].fontFace?.push( item );
			return acc;
		},
		{}
	);
	return Object.values( fontFamiliesObject ) as FontFamily[];
}
