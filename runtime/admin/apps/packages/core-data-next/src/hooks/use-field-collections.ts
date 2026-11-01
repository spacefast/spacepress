import { useSelect } from '@wordpress/data';
import { useMemo, useState, useEffect } from '@wordpress/element';
import { useEvent } from '@wordpress/compose';
import type { Field } from '@zero-admin/dataviews';
import { store } from '../store';
import type { FieldCollection } from '../store/types';

/**
 * Hook to get field collections for a specific entity and transform them into Field objects.
 *
 * @param kind                  Entity kind (e.g., 'postType', 'taxonomy', 'user')
 * @param name                  Entity name (e.g., 'attachment', 'post', 'category')
 * @param options               Options for filtering fields
 * @param options.allowedFields Optional list of field IDs to include
 * @return Array of Field objects from field collections
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic variance requires any for covariant Field<T> assignment
export function useFieldCollections< T = any >(
	kind: string,
	name: string,
	options?: { allowedFields?: string[] }
): Field< T >[] {
	/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- selector returns untyped store data */
	const fieldCollections = useSelect(
		( select ) => {
			const { getEntityFieldCollections } = select( store );
			return getEntityFieldCollections(
				kind,
				name
			) as FieldCollection< T >[];
		},
		[ kind, name ]
	);
	/* eslint-enable @typescript-eslint/no-unsafe-type-assertion */

	const [ loadedModules, setLoadedModules ] = useState<
		Record< string, Partial< Field< T > >[] >
	>( {} );

	const loadModuleForCollection = useEvent(
		async ( collection: FieldCollection< T > ) => {
			if ( ! collection.fields_module ) {
				setLoadedModules( ( prev ) => ( {
					...prev,
					[ collection.id ]: [],
				} ) );
				return;
			}

			/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
			const module = await import( collection.fields_module );
			setLoadedModules( ( prev ) => ( {
				...prev,
				[ collection.id ]: module.default || [],
			} ) );
			/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
		}
	);

	// Load script modules and merge extensions
	useEffect( () => {
		if ( ! fieldCollections || fieldCollections.length === 0 ) {
			return;
		}

		// Process each collection that has a fields_module
		for ( const collection of fieldCollections ) {
			void loadModuleForCollection( collection );
		}
	}, [ fieldCollections, loadModuleForCollection ] );

	const enhancedFields: Field< T >[] = useMemo( () => {
		if ( ! fieldCollections || fieldCollections.length === 0 ) {
			return [];
		}

		// Verify every current collection has a loaded module (not just count).
		// When switching entities, stale keys from the previous entity can make
		// the count match while new collections are still loading.
		const allLoaded = fieldCollections.every(
			( collection ) => collection.id in loadedModules
		);
		if ( ! allLoaded ) {
			return [];
		}

		return fieldCollections.flatMap( ( collection ) => {
			const extensions = loadedModules[ collection.id ];
			return collection.fields.map( ( field: Field< T > ) => {
				const extensitionField = extensions.find(
					( f ) => f.id === field.id
				);
				if ( extensitionField ) {
					return {
						...field,
						...extensitionField,
					};
				}
				return field;
			} );
		} );
	}, [ fieldCollections, loadedModules ] );

	const allowedFields = options?.allowedFields;
	const filteredFields = useMemo( () => {
		if ( ! allowedFields || allowedFields.length === 0 ) {
			return enhancedFields;
		}
		return enhancedFields.filter( ( field ) =>
			allowedFields.includes( field.id )
		);
	}, [ enhancedFields, allowedFields ] );

	return filteredFields;
}
