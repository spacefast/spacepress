import { render, screen, waitFor } from '@testing-library/react';
import { SlotFillProvider } from '@wordpress/components';
import { createRegistry, RegistryProvider } from '@wordpress/data';
import Page from '../index';

const mockRegisterBeforeSaveHandler = jest.fn();

jest.mock( '../../../utils/save-dirty-entities', () => ( {
	registerBeforeSaveHandler: (
		...args: unknown[]
	): ReturnType< typeof mockRegisterBeforeSaveHandler > =>
		mockRegisterBeforeSaveHandler( ...args ),
} ) );

// Mock scrollTo for testing environment
Object.defineProperty( Element.prototype, 'scrollTo', {
	value: jest.fn(),
	writable: true,
} );

describe( 'Page', () => {
	beforeEach( () => {
		mockRegisterBeforeSaveHandler.mockReset();
	} );

	it( 'should render children', () => {
		render(
			<Page>
				<div>Test content</div>
			</Page>
		);

		expect( screen.getByText( 'Test content' ) ).toBeInTheDocument();
	} );

	it( 'should render with custom className', () => {
		const { container } = render(
			<Page className="custom-class">
				<div>Test content</div>
			</Page>
		);

		expect( container.firstChild ).toHaveClass(
			'first-admin-page',
			'custom-class'
		);
	} );

	it( 'should render header when title is provided', () => {
		render(
			<SlotFillProvider>
				<Page title="Test Title">
					<div>Test content</div>
				</Page>
			</SlotFillProvider>
		);

		expect( screen.getByText( 'Test Title' ) ).toBeInTheDocument();
	} );

	it( 'should render content with padding by default', () => {
		render(
			<Page>
				<div>Test content</div>
			</Page>
		);

		const contentDiv = screen.getByText( 'Test content' ).parentNode;
		expect( contentDiv ).toHaveClass(
			'first-admin-page__content',
			'has-padding'
		);
	} );

	it( 'should render content without padding when hasPadding is false', () => {
		render(
			<Page hasPadding={ false }>
				<div>Test content</div>
			</Page>
		);

		const contentDiv = screen.getByText( 'Test content' ).parentNode;
		expect( contentDiv ).toHaveClass( 'first-admin-page__content' );
		expect( contentDiv ).not.toHaveClass( 'has-padding' );
	} );

	it( 'registers beforeSave with the current registry and unregisters on unmount', async () => {
		const registry = createRegistry();
		const beforeSave = jest.fn();
		const unregister = jest.fn();

		mockRegisterBeforeSaveHandler.mockReturnValue( unregister );

		const { unmount } = render(
			<RegistryProvider value={ registry }>
				<Page
					saveButton={ {
						beforeSave,
					} }
				>
					<div>Test content</div>
				</Page>
			</RegistryProvider>
		);

		await waitFor( () => {
			expect( mockRegisterBeforeSaveHandler ).toHaveBeenCalledWith(
				registry,
				beforeSave
			);
		} );

		unmount();

		expect( unregister ).toHaveBeenCalledTimes( 1 );
	} );
} );
