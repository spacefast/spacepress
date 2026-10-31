import { render } from '@testing-library/react';
import { createRef } from 'react';
import { InputControl } from '../index';

describe( 'InputControl', () => {
	it( 'forwards ref', () => {
		const ref = createRef< HTMLInputElement >();

		render( <InputControl ref={ ref } label="Username" /> );

		expect( ref.current ).toBeInstanceOf( HTMLInputElement );
	} );
} );
