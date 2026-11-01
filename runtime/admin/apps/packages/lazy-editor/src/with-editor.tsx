import type { ReactNode } from 'react';
import { useEditorAssets } from './use-editor-assets';
import { useEditorSettings } from './use-editor-settings';

export function withEditor< T >(
	Component: React.ComponentType< T >
): React.FC<
	Omit< T, 'settings' > & {
		loadingFallback?: ReactNode;
		stylesId: string;
	}
> {
	return function WrappedComponent( props ) {
		const { loadingFallback = null } = props;
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const { isReady: settingsReady, editorSettings } = useEditorSettings( {
			stylesId: props.stylesId,
		} );
		const { isReady: assetsReady } = useEditorAssets();

		if ( ! settingsReady || ! assetsReady ) {
			return loadingFallback;
		}
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-type-assertion
		return <Component { ...( props as T ) } settings={ editorSettings } />;
	};
}
