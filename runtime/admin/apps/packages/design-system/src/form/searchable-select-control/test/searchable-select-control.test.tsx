import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchableSelectControl } from '../index';

describe( 'SearchableSelectControl', () => {
	const mockItems = [
		{ value: '', label: 'Select' },
		{ value: 'apple', label: 'Apple' },
		{ value: 'banana', label: 'Banana' },
		{ value: 'cherry', label: 'Cherry' },
	];

	it( 'renders accessible label and description', () => {
		render(
			<SearchableSelectControl
				label="Fruit"
				description="Choose your favorite fruit"
				items={ mockItems }
			/>
		);

		expect(
			screen.getByRole( 'combobox', {
				name: 'Fruit',
				description: 'Choose your favorite fruit',
			} )
		).toBeVisible();
	} );

	describe( 'Form data behavior', () => {
		it( 'submits correct form data when option is selected', async () => {
			const user = userEvent.setup();
			const handleSubmit = jest.fn( ( event ) => {
				event.preventDefault();
				return new FormData( event.currentTarget );
			} );

			render(
				<form onSubmit={ handleSubmit }>
					<SearchableSelectControl
						label="Fruit"
						name="fruit"
						items={ mockItems }
					/>
					<button type="submit">Submit</button>
				</form>
			);

			const selectTrigger = screen.getByRole( 'combobox', {
				name: 'Fruit',
			} );
			const submitButton = screen.getByRole( 'button', {
				name: 'Submit',
			} );

			await user.click( selectTrigger );

			const optionToSelect = await screen.findByRole( 'option', {
				name: /Banana/i,
			} );
			await user.click( optionToSelect );

			await user.click( submitButton );

			const formData = handleSubmit.mock.results[ 0 ].value;
			expect( formData.get( 'fruit' ) ).toBe( 'banana' );
		} );

		it( 'submits form data with default value when no selection is made', async () => {
			const user = userEvent.setup();
			const handleSubmit = jest.fn( ( event ) => {
				event.preventDefault();
				return new FormData( event.currentTarget );
			} );

			render(
				<form onSubmit={ handleSubmit }>
					<SearchableSelectControl
						label="Fruit"
						name="fruit"
						items={ mockItems }
						defaultValue={ mockItems[ 0 ] }
					/>
					<button type="submit">Submit</button>
				</form>
			);

			const submitButton = screen.getByRole( 'button', {
				name: 'Submit',
			} );

			// Submit the form without making a selection
			await user.click( submitButton );

			const formData = handleSubmit.mock.results[ 0 ].value;
			expect( formData.get( 'fruit' ) ).toBe( '' );
		} );
	} );
} );
