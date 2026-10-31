import { render, screen } from '@testing-library/react';
import * as Fieldset from '../index';

describe( 'Fieldset', () => {
	it( 'accessibly associates description when Fieldset.Description is present', () => {
		render(
			<Fieldset.Root>
				<Fieldset.Legend>Choose your options</Fieldset.Legend>
				<Fieldset.Description>
					Select one or more options from the list below.
				</Fieldset.Description>
			</Fieldset.Root>
		);

		expect(
			screen.getByRole( 'group', {
				name: 'Choose your options',
				description: 'Select one or more options from the list below.',
			} )
		).toBeVisible();
	} );

	it( 'does not add aria-describedby when Fieldset.Description is not present', () => {
		render(
			<Fieldset.Root>
				<Fieldset.Legend>Choose your options</Fieldset.Legend>
			</Fieldset.Root>
		);

		const fieldset = screen.getByRole( 'group', {
			name: 'Choose your options',
		} );

		// Should not have aria-describedby
		expect( fieldset ).not.toHaveAttribute( 'aria-describedby' );
	} );

	it( 'respects custom id on description', () => {
		const customId = 'custom-description-id';

		render(
			<Fieldset.Root>
				<Fieldset.Legend>Choose your options</Fieldset.Legend>
				<Fieldset.Description id={ customId }>
					Custom description with specific ID.
				</Fieldset.Description>
			</Fieldset.Root>
		);

		const description = screen.getByText(
			'Custom description with specific ID.'
		);
		expect( description ).toHaveAttribute( 'id', customId );

		expect(
			screen.getByRole( 'group', {
				name: 'Choose your options',
				description: 'Custom description with specific ID.',
			} )
		).toBeVisible();
	} );
} );
