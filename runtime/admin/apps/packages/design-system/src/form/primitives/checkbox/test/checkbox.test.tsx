import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { Checkbox } from '../index';

describe( 'Checkbox', () => {
	it( 'forwards ref', () => {
		const ref = createRef< HTMLSpanElement >();

		render( <Checkbox ref={ ref } /> );

		expect( ref.current ).toBeInstanceOf( HTMLSpanElement );
	} );

	it( 'shows the indicator only when checked', async () => {
		const user = userEvent.setup();

		render( <Checkbox /> );

		const checkbox = screen.getByRole( 'checkbox' );

		expect( checkbox.querySelector( 'svg' ) ).toBeNull();

		await user.click( checkbox );

		expect( checkbox.querySelector( 'svg' ) ).toBeVisible();

		await user.click( checkbox );

		expect( checkbox.querySelector( 'svg' ) ).toBeNull();
	} );
} );
