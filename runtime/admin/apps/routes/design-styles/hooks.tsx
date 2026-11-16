import { useNavigate, useSearch } from '@wordpress/route';
import { mergeGlobalStyles } from '@typedpress-admin/global-styles-engine';
import type {
	GlobalStylesConfig,
	GlobalStylesSettings,
} from '@typedpress-admin/global-styles-engine';
import { store as coreStore } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { useMemo } from '@wordpress/element';
import { store as editorStore } from '@wordpress/editor';
import { uploadMedia } from '@wordpress/media-utils';

export function useGlobalStyles( id: string ) {
	const { userGlobalStyles } = useSelect(
		( select ) => {
			const { getEntityRecord, getEditedEntityRecord, canUser } =
				select( coreStore );

			/*
			 * Ensure that the global styles ID request is complete by testing `_globalStylesId`,
			 * before firing off the `canUser` OPTIONS request for user capabilities, otherwise it will
			 * fetch `/wp/v2/global-styles` instead of `/wp/v2/global-styles/{id}`.
			 * NOTE: Please keep in sync any preload paths sent to `block_editor_rest_api_preload()`,
			 * or set using the `block_editor_rest_api_preload_paths` filter, if this changes.
			 */
			const userCanEditGlobalStyles = canUser( 'update', {
				kind: 'root',
				name: 'globalStyles',
				id,
			} );

			let record;
			if (
				/*
				 * Test that the OPTIONS request for user capabilities is complete
				 * before fetching the global styles entity record.
				 * This is to avoid fetching the global styles entity unnecessarily.
				 */
				typeof userCanEditGlobalStyles === 'boolean'
			) {
				/*
				 * Fetch the global styles entity record based on the user's capabilities.
				 * The default context is `edit` for users who can edit global styles.
				 * Otherwise, the context is `view`.
				 */
				if ( userCanEditGlobalStyles ) {
					record = getEditedEntityRecord(
						'root',
						'globalStyles',
						id
					);
				} else {
					record = getEntityRecord( 'root', 'globalStyles', id, {
						context: 'view',
					} );
				}
			}

			return {
				userGlobalStyles: record,
			};
		},
		[ id ]
	);

	const baseConfig: GlobalStylesConfig | undefined = useSelect(
		( select ) =>
			select( coreStore ).__experimentalGetCurrentThemeBaseGlobalStyles(),
		[]
	);

	return useMemo( () => {
		if ( ! userGlobalStyles || ! baseConfig ) {
			return {
				user: undefined,
				base: undefined,
				merged: undefined,
			};
		}

		const user = userGlobalStyles as GlobalStylesConfig;
		const base = baseConfig;
		const merged = mergeGlobalStyles( base, user );

		return {
			user,
			base,
			merged,
		};
	}, [ userGlobalStyles, baseConfig ] );
}

/**
 * Returns the non-global styles editor styles and settings.
 *
 * To render previews properly. The server provides some extra styles and assets
 * that are provided by themes in non conventional ways as either styles or __unstableResolvedAssets.
 * This hook extracts these from the editor settings to allow us to render the previews properly.
 *
 * @return {Array} An array containing the non-global styles and settings.
 */
export function useNonGlobalStylesEditorStylesAndSettings(): [
	{ isGlobalStyles?: boolean }[],
	(
		| {
				__unstableResolvedAssets: Record< string, unknown >;
				settings: GlobalStylesSettings;
				__experimentalDiscussionSettings?: unknown;
		  }
		| undefined
	),
] {
	const {
		styles,
		__unstableResolvedAssets,
		colors,
		gradients,
		__experimentalDiscussionSettings,
		mediaUpload,
	} = useSelect( ( select ) => {
		const { getEditorSettings } = select( editorStore );
		const { canUser } = select( coreStore );
		const editorSettings = getEditorSettings() as {
			styles: { isGlobalStyles?: boolean }[];
			__unstableResolvedAssets: Record< string, unknown >;
			colors?: unknown[];
			gradients?: unknown[];
			__experimentalDiscussionSettings?: unknown;
		};
		const canUserUploadMedia = canUser( 'create', {
			kind: 'root',
			name: 'media',
		} );
		return {
			styles: editorSettings.styles,
			__unstableResolvedAssets: editorSettings.__unstableResolvedAssets,
			colors: editorSettings.colors,
			gradients: editorSettings.gradients,
			__experimentalDiscussionSettings:
				editorSettings.__experimentalDiscussionSettings,
			mediaUpload: canUserUploadMedia ? uploadMedia : undefined,
		};
	}, [] );

	const nonGlobalStyles = useMemo( () => {
		if ( ! styles ) {
			return [];
		}

		return Object.values( styles ?? [] ).filter(
			( style ) => ! style.isGlobalStyles
		);
	}, [ styles ] );

	const serverSettings = useMemo( () => {
		const settings: GlobalStylesSettings = {
			color: {
				palette: {
					theme: colors as any,
				},
				gradients: {
					theme: gradients as any,
				},
				duotone: {
					theme: [],
				},
			},
		};

		return {
			__unstableResolvedAssets,
			settings,
			__experimentalDiscussionSettings,
			mediaUpload,
		};
	}, [
		colors,
		gradients,
		__unstableResolvedAssets,
		__experimentalDiscussionSettings,
		mediaUpload,
	] );

	return [ nonGlobalStyles, serverSettings ];
}

export function useSection(): [
	string | undefined,
	( section: string ) => void,
] {
	const navigate = useNavigate();
	const searchParams = useSearch( { from: '/design/styles' } );

	return useMemo( () => {
		const currentSection = searchParams.section as string | undefined;

		const setSection = ( section: string ) => {
			navigate( {
				search: {
					...searchParams,
					section,
				},
			} );
		};

		return [ currentSection, setSection ];
	}, [ navigate, searchParams ] );
}
