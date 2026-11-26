import { useImageCropper } from '@spacepress-admin/image-cropper';
import { store as coreStore } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { useMemo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { type AspectRatio } from '../components/media-renderer/image/editing-tools/aspect-ratio';

export default function useGetAspectRatios() {
	const baseConfig = useSelect(
		( select ) =>
			select( coreStore ).__experimentalGetCurrentThemeBaseGlobalStyles(),
		[]
	);
	const { resetState } = useImageCropper();

	return useMemo( () => {
		const showDefaultRatios =
			!! baseConfig?.settings?.dimensions?.defaultAspectRatios;
		const imageAspectRatios: AspectRatio[] = [
			{
				name: __( 'Image Aspect Ratio', 'spacepress-admin' ),
				slug: 'image',
				ratio: resetState?.aspectRatio ?? 1,
			},
		];

		return {
			imageAspectRatios,
			default:
				showDefaultRatios &&
				!! baseConfig?.settings?.dimensions?.aspectRatios?.default
					?.length
					? baseConfig.settings.dimensions.aspectRatios.default
					: [],
			theme: !! baseConfig?.settings?.dimensions?.aspectRatios?.theme
				?.length
				? baseConfig.settings.dimensions.aspectRatios.theme
				: [],
		};
	}, [ baseConfig, resetState ] );
}
