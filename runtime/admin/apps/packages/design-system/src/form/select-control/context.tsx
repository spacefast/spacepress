import { createContext, useContext } from 'react';
import type { SelectTriggerProps } from '../primitives/select/types';

export const SelectControlSizeContext =
	createContext< SelectTriggerProps[ 'size' ] >( undefined );

export const useSelectControlSizeContext = () => {
	return useContext( SelectControlSizeContext );
};
