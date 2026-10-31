import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { SearchableSelect } from '../index';

describe( 'SearchableSelect', () => {
	it( 'forwards ref', async () => {
		const ref = createRef< HTMLButtonElement >();

		render( <SearchableSelect ref={ ref } /> );

		// Test that the ref is attached to an HTMLButtonElement
		expect( ref.current ).toBeInstanceOf( HTMLButtonElement );
	} );

	it( 'passes aria-label and aria-describedby props to the appropriate components', () => {
		render(
			<>
				<SearchableSelect
					aria-label="My label"
					aria-describedby="searchable-select-description"
				/>
				<p id="searchable-select-description">My description</p>
			</>
		);

		expect(
			screen.getByRole( 'combobox', {
				name: 'My label',
				description: 'My description',
			} )
		).toBeInTheDocument();
	} );

	it( 'passes aria-labelledby prop to the appropriate component', () => {
		render(
			<>
				<p id="searchable-select-label">My label</p>
				<SearchableSelect aria-labelledby="searchable-select-label" />
			</>
		);

		expect(
			screen.getByRole( 'combobox', {
				name: 'My label',
			} )
		).toBeInTheDocument();
	} );
} );
