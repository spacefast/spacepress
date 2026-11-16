import { unlock } from '@typedpress-admin/admin-toolkit';
import { __, _x } from '@wordpress/i18n';
import {
	Modal,
	privateApis as componentsPrivateApis,
} from '@wordpress/components';
import { store as coreStore } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { useContext } from '@wordpress/element';
import './style.scss';
import InstalledFonts from './installed-fonts';
import FontCollection from './font-collection';
import UploadFonts from './upload-fonts';
import { FontLibraryContext } from './context';
import type { FontCollection as FontCollectionType } from './types';

const { Tabs } = unlock( componentsPrivateApis );

const DEFAULT_TAB = {
	id: 'installed-fonts',
	title: _x( 'Library', 'Font library', 'typedpress-admin' ),
};

const UPLOAD_TAB = {
	id: 'upload-fonts',
	title: _x( 'Upload', 'noun', 'typedpress-admin' ),
};

const tabsFromCollections = ( collections: FontCollectionType[] ) =>
	collections.map( ( { slug, name } ) => ( {
		id: slug,
		title:
			collections.length === 1 && slug === 'google-fonts'
				? __( 'Install Fonts', 'typedpress-admin' )
				: name,
	} ) );

function FontLibraryModal( {
	onRequestClose,
	defaultTabId = 'installed-fonts',
}: {
	onRequestClose: () => void;
	defaultTabId?: string;
} ) {
	const { collections } = useContext( FontLibraryContext );
	const canUserCreate = useSelect( ( select ) => {
		return select( coreStore ).canUser( 'create', {
			kind: 'postType',
			name: 'wp_font_family',
		} );
	}, [] );

	const tabs: { id: string; title: string }[] = [ DEFAULT_TAB ];

	if ( canUserCreate ) {
		tabs.push( UPLOAD_TAB );
		tabs.push( ...tabsFromCollections( collections || [] ) );
	}

	return (
		<Modal
			title={ __( 'Fonts', 'typedpress-admin' ) }
			onRequestClose={ onRequestClose }
			isFullScreen
			className="typedpress-admin-font-library-modal"
		>
			<Tabs defaultTabId={ defaultTabId }>
				<div className="font-library-modal__tablist-container">
					<Tabs.TabList>
						{ tabs.map( ( { id, title } ) => (
							<Tabs.Tab key={ id } tabId={ id }>
								{ title }
							</Tabs.Tab>
						) ) }
					</Tabs.TabList>
				</div>
				{ tabs.map( ( { id } ) => {
					let contents;
					switch ( id ) {
						case 'upload-fonts':
							contents = <UploadFonts />;
							break;
						case 'installed-fonts':
							contents = <InstalledFonts />;
							break;
						default:
							contents = <FontCollection slug={ id } />;
					}
					return (
						<Tabs.TabPanel
							key={ id }
							tabId={ id }
							focusable={ false }
						>
							{ contents }
						</Tabs.TabPanel>
					);
				} ) }
			</Tabs>
		</Modal>
	);
}

export default FontLibraryModal;
