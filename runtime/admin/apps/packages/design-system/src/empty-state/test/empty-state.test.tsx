import { createRef } from 'react';
import { render } from '@testing-library/react';
import { Root } from '../index';

describe( 'EmptyState.Root', () => {
	it( 'forwards ref', () => {
		const ref = createRef< HTMLDivElement >();

		render( <Root ref={ ref }>Empty state content</Root> );

		expect( ref.current ).toBeInstanceOf( HTMLDivElement );
	} );
} );
