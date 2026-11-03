import {
	useState,
	createContext,
	useContext,
	useMemo,
} from '@wordpress/element';
import { createHigherOrderComponent } from '@wordpress/compose';
import { type AspectRatio } from '../components/media-renderer/image/editing-tools/aspect-ratio';

/*
	This provider is used to manage the state of the media editor,
	until there's cause for a fully-fledged store/state management solution.
*/

export interface MediaEditorStateContextValue {
	isImageEditorOpen: boolean;
	setIsImageEditorOpen: ( isImageEditorOpen: boolean ) => void;
	isEditInProgress: boolean;
	setIsEditInProgress: ( isSaveInProgress: boolean ) => void;
	selectedAspectRatio: AspectRatio | null;
	setSelectedAspectRatio: ( selectedAspectRatio: AspectRatio | null ) => void;
}

const MediaEditorStateContext = createContext< MediaEditorStateContextValue >( {
	isImageEditorOpen: false,
	setIsImageEditorOpen: () => {},
	setIsEditInProgress: () => {},
	isEditInProgress: false,
	selectedAspectRatio: null,
	setSelectedAspectRatio: () => {},
} );

const withMediaEditorStateProvider = createHigherOrderComponent(
	( WrappedComponent ) => {
		const Component = ( { ...props } ) => {
			const [ isImageEditorOpen, setIsImageEditorOpen ] =
				useState( false );
			const [ isEditInProgress, setIsEditInProgress ] =
				useState< boolean >( false );
			const [ selectedAspectRatio, setSelectedAspectRatio ] =
				useState< AspectRatio | null >( null );
			const contextValue = useMemo( () => {
				return {
					isImageEditorOpen,
					setIsImageEditorOpen,
					isEditInProgress,
					setIsEditInProgress,
					selectedAspectRatio,
					setSelectedAspectRatio,
				};
			}, [
				isImageEditorOpen,
				setIsImageEditorOpen,
				isEditInProgress,
				setIsEditInProgress,
				selectedAspectRatio,
				setSelectedAspectRatio,
			] );

			return (
				<MediaEditorStateContext.Provider value={ contextValue }>
					<WrappedComponent { ...props } />
				</MediaEditorStateContext.Provider>
			);
		};

		Component.displayName = `withMediaEditorStateProvider(${
			WrappedComponent.displayName || WrappedComponent.name || 'Component'
		})`;
		return Component;
	},
	'withMediaEditorStateProvider'
);

export default withMediaEditorStateProvider;

export const useMediaEditorState = () => {
	const context = useContext( MediaEditorStateContext );
	if ( ! context ) {
		throw new Error( 'Missing MediaEditorStateContext' );
	}
	return context;
};
