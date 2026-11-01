import { render } from '@testing-library/react';
import { createRef } from 'react';
import { TreeSelectControl } from '../index';

describe( 'TreeSelectControl', () => {
	it( 'forwards ref', () => {
		const ref = createRef< HTMLDivElement >();

		render( <TreeSelectControl ref={ ref } label="Tree" /> );

		expect( ref.current ).toBeInstanceOf( HTMLElement );
	} );
} );
