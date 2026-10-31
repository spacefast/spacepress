import { createRef } from 'react';
import { render } from '@testing-library/react';
import { SearchableSelectControl } from '../index';

describe( 'SearchableSelectControl', () => {
	it( 'forwards ref', () => {
		const ref = createRef< HTMLButtonElement >();

		render(
			<SearchableSelectControl ref={ ref } label="Select an option" />
		);

		expect( ref.current ).toBeInstanceOf( HTMLButtonElement );
	} );
} );
