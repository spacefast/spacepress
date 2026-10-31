import { createContext, useContext } from '@wordpress/element';
import { createHigherOrderComponent } from '@wordpress/compose';

/*
 * The media editor once carried crop/rotate state here. With the image
 * editor gone the provider is an identity wrapper kept for the components
 * that still read its (now empty) context; it goes when they are rewired.
 */
export type MediaEditorStateContextValue = Record< string, never >;

const MediaEditorStateContext = createContext< MediaEditorStateContextValue >( {} );

const withMediaEditorStateProvider = createHigherOrderComponent(
	( WrappedComponent ) => {
		const Component = ( { ...props } ) => (
			<MediaEditorStateContext.Provider value={ {} }>
				<WrappedComponent { ...props } />
			</MediaEditorStateContext.Provider>
		);
		Component.displayName = `withMediaEditorStateProvider(${
			WrappedComponent.displayName || WrappedComponent.name || 'Component'
		})`;
		return Component;
	},
	'withMediaEditorStateProvider'
);

export default withMediaEditorStateProvider;

export const useMediaEditorState = () => useContext( MediaEditorStateContext );
