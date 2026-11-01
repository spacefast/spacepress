import { createContext, useContext } from 'react';

export type FieldsetContextType = {
	registerDescriptionId: ( id: string ) => void;
	unregisterDescriptionId: () => void;
};

export const FieldsetContext = createContext< FieldsetContextType >( {
	registerDescriptionId: () => {},
	unregisterDescriptionId: () => {},
} );

export const useFieldsetContext = () => useContext( FieldsetContext );
