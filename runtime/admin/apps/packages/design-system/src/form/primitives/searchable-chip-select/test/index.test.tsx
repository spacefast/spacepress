import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { SearchableChipSelect } from '../index';

describe( 'SearchableChipSelect', () => {
	it( 'forwards ref', async () => {
		const ref = createRef< HTMLDivElement >();

		render( <SearchableChipSelect ref={ ref } /> );

		// Test that the ref is attached to an HTMLDivElement
		expect( ref.current ).toBeInstanceOf( HTMLDivElement );
	} );

	it( 'passes aria-label and aria-describedby props to the appropriate components', () => {
		render(
			<>
				<SearchableChipSelect
					aria-label="My label"
					aria-describedby="searchable-chip-select-description"
				/>
				<p id="searchable-chip-select-description">My description</p>
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
				<p id="searchable-chip-select-label">My label</p>
				<SearchableChipSelect aria-labelledby="searchable-chip-select-label" />
			</>
		);

		expect(
			screen.getByRole( 'combobox', {
				name: 'My label',
			} )
		).toBeInTheDocument();
	} );
} );
