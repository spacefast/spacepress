/**
 * Immutably sets a value inside an object. Like `lodash#set`, but returning a
 * new object. Treats nullish initial values as empty objects. Clones any
 * nested objects. Supports arrays, too.
 *
 * @param object Object to set a value in.
 * @param path   Path in the object to modify.
 * @param value  New value to set.
 * @return Cloned object with the new value set.
 */
export function setImmutably(
	object: Object,
	path: string | number | ( string | number )[],
	value: any
) {
	// Normalize path
	path = Array.isArray( path ) ? [ ...path ] : [ path ];

	// Shallowly clone the base of the object
	object = Array.isArray( object ) ? [ ...object ] : { ...object };

	const leaf = path.pop();

	// Traverse object from root to leaf, shallowly cloning at each level
	let prev = object as Record< string | number, any >;
	for ( const key of path ) {
		const lvl = prev[ key ];
		prev = prev[ key ] = Array.isArray( lvl ) ? [ ...lvl ] : { ...lvl };
	}
	if ( leaf !== undefined ) {
		prev[ leaf ] = value;
	}

	return object;
}

export const getValueFromObjectPath = (
	object: Object,
	path: string | string[],
	defaultValue?: any
) => {
	const arrayPath = Array.isArray( path ) ? path : path.split( '.' );
	let value: any = object;
	arrayPath.forEach( ( fieldName ) => {
		value = ( value as Record< string, any > )?.[ fieldName ];
	} );
	return value ?? defaultValue;
};
