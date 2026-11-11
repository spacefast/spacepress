import { useNavigate, useSearch } from '@wordpress/route';
import { Page } from '@first-admin/admin-toolkit';
import { IconButton } from '@wordpress/ui';
import type { GlobalStylesConfig } from '@first-admin/global-styles-engine';
import { __ } from '@wordpress/i18n';
import { seen } from '@wordpress/icons';
import { useCallback } from '@wordpress/element';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { store as editorStore } from '@wordpress/editor';
import { GlobalStylesUI } from './global-styles-ui';
import {
	useGlobalStyles,
	useNonGlobalStylesEditorStylesAndSettings,
	useSection,
} from './hooks';

export default function DesignStylesInspector() {
	const navigate = useNavigate();
	const search = useSearch( { from: '/design/styles' } );
	const isStyleBookOpened = search.preview === 'stylebook';

	// Get the current global styles ID
	const globalStylesId = useSelect( ( select ) => {
		return select( coreStore ).__experimentalGetCurrentGlobalStylesId();
	}, [] );

	// Load the global styles using our updated hook
	const { user, base, merged } = useGlobalStyles( globalStylesId );

	// Get server CSS and settings for BlockEditorProvider
	const [ serverCSS, serverSettings ] =
		useNonGlobalStylesEditorStylesAndSettings();

	// Get current section from URL and setter function
	const [ currentSection, setSection ] = useSection();

	// Get edit capabilities and font library setting
	const { canEdit, fontLibraryEnabled } = useSelect(
		( select ) => {
			const { canUser } = select( coreStore );
			const { getEditorSettings } = select( editorStore );

			return {
				canEdit: globalStylesId
					? canUser( 'update', {
							kind: 'root',
							name: 'globalStyles',
							id: globalStylesId,
					  } )
					: false,
				fontLibraryEnabled:
					( getEditorSettings() as any )?.fontLibraryEnabled ?? false,
			};
		},
		[ globalStylesId ]
	);

	const { editEntityRecord } = useDispatch( coreStore );

	const handleGlobalStylesChange = useCallback(
		( newGlobalStyles: GlobalStylesConfig ) => {
			if ( canEdit && globalStylesId ) {
				editEntityRecord(
					'root',
					'globalStyles',
					globalStylesId,
					newGlobalStyles
				);
			}
		},
		[ canEdit, globalStylesId, editEntityRecord ]
	);

	const togglePreview = () => {
		navigate( {
			search: {
				...search,
				preview: isStyleBookOpened ? undefined : 'stylebook',
			},
		} );
	};

	// Show loading state while global styles are loading
	if ( ! user || ! base || ! merged || ! globalStylesId ) {
		return null;
	}

	return (
		<Page
			title={ __( 'Styles', 'first-admin' ) }
			actions={
				<IconButton
					aria-pressed={ isStyleBookOpened }
					variant="minimal"
					icon={ seen }
					label={ __( 'Style Book', 'first-admin' ) }
					onClick={ togglePreview }
					size="compact"
				/>
			}
			saveButton={ { isVisible: true } }
			hasPadding={ false }
		>
			<GlobalStylesUI
				value={ user }
				baseValue={ base }
				onChange={ handleGlobalStylesChange }
				path={ currentSection }
				onPathChange={ setSection }
				fontLibraryEnabled={ fontLibraryEnabled }
				serverCSS={ serverCSS }
				serverSettings={ serverSettings }
			/>
		</Page>
	);
}
