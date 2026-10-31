import React, { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextareaControl } from '../index';

describe( 'TextareaControl', () => {
	it( 'forwards ref', () => {
		const ref = createRef< HTMLTextAreaElement >();

		render( <TextareaControl ref={ ref } label="Comment" /> );

		expect( ref.current ).toBeInstanceOf( HTMLTextAreaElement );
	} );

	it( 'renders accessible label and description', () => {
		render(
			<TextareaControl
				label="Comment"
				description="Please provide your feedback"
			/>
		);

		expect(
			screen.getByRole( 'textbox', {
				name: 'Comment',
				description: 'Please provide your feedback',
			} )
		).toBeVisible();
	} );

	describe( 'Form data behavior', () => {
		it( 'submits correct form data with custom name and value', async () => {
			const user = userEvent.setup();
			const handleSubmit = jest.fn( ( event ) => {
				event.preventDefault();
				return new FormData( event.currentTarget );
			} );

			render(
				<form onSubmit={ handleSubmit }>
					<TextareaControl
						label="Message"
						name="message"
						defaultValue="Hello world"
					/>
					<button type="submit">Submit</button>
				</form>
			);

			// Submit the form
			await user.click(
				screen.getByRole( 'button', {
					name: 'Submit',
				} )
			);

			const formData = handleSubmit.mock.results[ 0 ].value;
			expect( formData.get( 'message' ) ).toBe( 'Hello world' );
		} );

		it( 'submits empty values identically to native textarea', async () => {
			const user = userEvent.setup();
			const handleCustomSubmit = jest.fn( ( event ) => {
				event.preventDefault();
				return new FormData( event.currentTarget );
			} );
			const handleNativeSubmit = jest.fn( ( event ) => {
				event.preventDefault();
				return new FormData( event.currentTarget );
			} );

			// Test TextareaControl with empty value
			const { rerender } = render(
				<form onSubmit={ handleCustomSubmit }>
					<TextareaControl
						label="Custom Field"
						name="empty"
						defaultValue=""
					/>
					<button type="submit">Submit Custom</button>
				</form>
			);

			await user.click(
				screen.getByRole( 'button', { name: 'Submit Custom' } )
			);

			// Test native textarea with empty value
			rerender(
				<form onSubmit={ handleNativeSubmit }>
					<textarea name="empty" defaultValue="" />
					<button type="submit">Submit Native</button>
				</form>
			);

			await user.click(
				screen.getByRole( 'button', { name: 'Submit Native' } )
			);

			const customFormData = handleCustomSubmit.mock.results[ 0 ].value;
			const nativeFormData = handleNativeSubmit.mock.results[ 0 ].value;

			// Both should submit empty string, not null or undefined
			expect( customFormData.get( 'empty' ) ).toBe(
				nativeFormData.get( 'empty' )
			);
			expect( customFormData.get( 'empty' ) ).toBe( '' );
		} );

		it( 'submits missing name attribute identically to native textarea', async () => {
			const user = userEvent.setup();
			const handleCustomSubmit = jest.fn( ( event ) => {
				event.preventDefault();
				return new FormData( event.currentTarget );
			} );
			const handleNativeSubmit = jest.fn( ( event ) => {
				event.preventDefault();
				return new FormData( event.currentTarget );
			} );

			// Test TextareaControl without name
			const { rerender } = render(
				<form onSubmit={ handleCustomSubmit }>
					<TextareaControl
						label="Custom Field"
						defaultValue="Some content"
					/>
					<button type="submit">Submit Custom</button>
				</form>
			);

			await user.click(
				screen.getByRole( 'button', { name: 'Submit Custom' } )
			);

			// Test native textarea without name
			rerender(
				<form onSubmit={ handleNativeSubmit }>
					<textarea defaultValue="Some content" />
					<button type="submit">Submit Native</button>
				</form>
			);

			await user.click(
				screen.getByRole( 'button', { name: 'Submit Native' } )
			);

			const customFormData = handleCustomSubmit.mock.results[ 0 ].value;
			const nativeFormData = handleNativeSubmit.mock.results[ 0 ].value;

			// Both should have no entries when name is missing
			const customEntries = Array.from( customFormData.entries() );
			const nativeEntries = Array.from( nativeFormData.entries() );

			expect( customEntries ).toHaveLength( nativeEntries.length );
			expect( customEntries ).toHaveLength( 0 );
		} );
	} );
} );
