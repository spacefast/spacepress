import { render } from '@testing-library/react';
import { createRef } from 'react';
import { Switch } from '../index';

describe( 'Switch', () => {
	it( 'forwards ref', () => {
		const ref = createRef< HTMLSpanElement >();

		render( <Switch ref={ ref } /> );

		expect( ref.current ).toBeInstanceOf( HTMLSpanElement );
	} );
} );
