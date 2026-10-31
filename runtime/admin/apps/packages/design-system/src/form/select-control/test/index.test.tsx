import { render } from '@testing-library/react';
import { createRef } from 'react';
import { SelectControl } from '../index';

describe( 'SelectControl', () => {
	it( 'forwards ref', () => {
		const selectRef = createRef< HTMLInputElement >();

		const items = [
			{ label: 'Option 1', value: 'option1' },
			{ label: 'Option 2', value: 'option2' },
		];

		render(
			<SelectControl
				ref={ selectRef }
				label="Select an option"
				items={ items }
			/>
		);

		expect( selectRef.current ).toBeInstanceOf( HTMLInputElement );
	} );
} );
