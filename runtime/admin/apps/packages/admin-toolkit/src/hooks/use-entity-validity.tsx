import {
	createContext,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useState,
} from '@wordpress/element';
import type { PropsWithChildren } from 'react';

type DocumentChanges = {
	dirty: boolean;
	valid: boolean;
	saving: boolean;
	save: () => Promise<unknown>;
};
type EntityValidityContextValue = {
	isEntityValid: boolean;
	setIsEntityValid: ( isEntityValid: boolean ) => void;
	documentChanges: DocumentChanges | null;
	setDocumentChanges: ( changes: DocumentChanges | null ) => void;
};

const EntityValidityContext = createContext<
	EntityValidityContextValue | undefined
>( undefined );

export function EntityValidityProvider( { children }: PropsWithChildren ) {
	const [ isEntityValid, setIsEntityValid ] = useState( true );
	const [ documentChanges, setDocumentChanges ] = useState<DocumentChanges | null>( null );

	const contextValue = useMemo(
		() => ( {
			isEntityValid,
			setIsEntityValid,
			documentChanges,
			setDocumentChanges,
		} ),
		[ isEntityValid, documentChanges ]
	);

	return (
		<EntityValidityContext.Provider value={ contextValue }>
			{ children }
		</EntityValidityContext.Provider>
	);
}

export function useEntityValidity() {
	const context = useContext( EntityValidityContext );
	if ( ! context ) {
		throw new Error(
			'useEntityValidity must be used within EntityValidityProvider.'
		);
	}

	return context;
}

export function useSetEntityValidity( isValid: boolean ) {
	const { setIsEntityValid } = useEntityValidity();

	useEffect( () => {
		setIsEntityValid( isValid );
	}, [ isValid, setIsEntityValid ] );
}

/** The mounted plain document supplies the same leave flow as core-data editors. */
export function useDocumentChanges({ dirty, valid, saving, save }: DocumentChanges) {
	const { documentChanges, setDocumentChanges } = useEntityValidity();
	useLayoutEffect(() => {
		setDocumentChanges({ dirty, valid, saving, save });
	}, [dirty, valid, saving, save, setDocumentChanges]);
	useLayoutEffect(() => () => setDocumentChanges(null), [setDocumentChanges]);
	return documentChanges;
}
