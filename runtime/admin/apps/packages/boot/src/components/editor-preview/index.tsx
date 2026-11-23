import { useRef } from 'react';
import { unlock } from '@spacepress-admin/admin-toolkit';
import { withEditor, withStylesId } from '@spacepress-admin/lazy-editor';
import { Disabled } from '@wordpress/components';
import {
	privateApis as blockEditorPrivateApis,
	BlockContextProvider,
	BlockList,
	__unstableIframe as Iframe,
	__unstableEditorStyles as EditorStyles,
	// @ts-expect-error - @wordpress/block-editor is not typed
} from '@wordpress/block-editor';
import '../media-modal';

const { ExperimentalBlockEditorProvider } = unlock( blockEditorPrivateApis );

/**
 * REFACTOR: Transition to using WordPress Editor component instead of custom block editor setup
 *
 * Current approach: This component creates a custom block editor instance using
 * ExperimentalBlockEditorProvider + BlockList + Iframe, which duplicates patterns
 * from the main Editor component.
 *
 * Ideal approach: Use the `Editor` component from `@wordpress/editor` package.
 *
 * This custom approach is justified for now to support context-driven blocks and
 * virtual previews, but should be revisited.
 * @param object
 * @param object.template
 * @param object.postType
 * @param object.postId
 * @param object.settings
 */
function EditorPreview( {
	settings,
	template,
	postType,
	postId,
}: {
	template?: Record< string, unknown >[];
	postType: string | undefined;
	postId: string | undefined;
	settings: Record< string, unknown >;
} ) {
	const iframeBodyRef = useRef< HTMLElement >();

	return (
		<div className="spacepress-admin-site-editor">
			<BlockContextProvider value={ { postId, postType } }>
				<ExperimentalBlockEditorProvider
					value={ template }
					settings={ settings }
				>
					<Iframe
						onLoad={ () => {
							if ( iframeBodyRef.current ) {
								iframeBodyRef.current.style.height = '100%';
								iframeBodyRef.current.style.width = '100%';
							}
						} }
						ref={ iframeBodyRef }
					>
						<Disabled>
							<EditorStyles styles={ settings.styles } />
							<BlockList renderAppender={ false } />
						</Disabled>
					</Iframe>
				</ExperimentalBlockEditorProvider>
			</BlockContextProvider>
		</div>
	);
}

export default withStylesId( withEditor( EditorPreview ) );
