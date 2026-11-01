import { dequal } from 'dequal';
import { useRef } from '@wordpress/element';

/**
 * Stores value in a ref. In subsequent render, value will be compared with ref.current using `dequal`.
 * If it is equal, returns ref.current; else, set ref.current to be value.
 *
 * This is useful for objects used in hook dependencies.
 *
 * @param value Value to be stored in ref.
 * @return Value stored in ref.
 */
const useIsEqualRefValue = < T >( value: T ): T => {
	const optionsRef = useRef< T >( value );

	if ( ! dequal( optionsRef.current, value ) ) {
		optionsRef.current = value;
	}

	return optionsRef.current;
};

export default useIsEqualRefValue;
