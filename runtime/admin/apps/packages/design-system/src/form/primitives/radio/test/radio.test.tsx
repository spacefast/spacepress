import { render } from '@testing-library/react';
import { createRef } from 'react';
import { Radio } from '../index';

describe( 'Radio', () => {
	it( 'forwards ref', () => {
		const ref = createRef< HTMLSpanElement >();

		render( <Radio ref={ ref } value="test" /> );

		expect( ref.current ).toBeInstanceOf( HTMLSpanElement );
	} );
} );
