import { render } from '@testing-library/react';
import { createRef } from 'react';
import * as CheckboxGroup from '../index';

describe( 'CheckboxGroup', () => {
	it( 'forwards ref', () => {
		const rootRef = createRef< HTMLDivElement >();
		const nestedItemsRef = createRef< HTMLDivElement >();

		render(
			<CheckboxGroup.Root ref={ rootRef }>
				<CheckboxGroup.NestedItems ref={ nestedItemsRef } />
			</CheckboxGroup.Root>
		);

		expect( rootRef.current ).toBeInstanceOf( HTMLDivElement );
		expect( nestedItemsRef.current ).toBeInstanceOf( HTMLDivElement );
	} );
} );
