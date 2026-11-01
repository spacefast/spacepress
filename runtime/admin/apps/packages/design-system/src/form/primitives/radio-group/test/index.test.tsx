import { render } from '@testing-library/react';
import { createRef } from 'react';
import { RadioGroup } from '../index';

describe( 'RadioGroup', () => {
	it( 'forwards ref', () => {
		const ref = createRef< HTMLDivElement >();

		render( <RadioGroup ref={ ref } /> );

		expect( ref.current ).toBeInstanceOf( HTMLDivElement );
	} );
} );
