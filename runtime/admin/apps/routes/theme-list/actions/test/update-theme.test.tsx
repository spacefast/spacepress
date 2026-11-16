import type { Theme } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import updateTheme from '../update-theme';
import { theme as twentyeleven } from './__mocks__/theme';

// Mock WordPress dependencies
jest.mock( '@wordpress/data', () => ( {
	combineReducers: jest.fn(),
	createSelector: jest.fn( ( fn ) => fn ),
	createReduxStore: jest.fn(),
	register: jest.fn(),
	useDispatch: jest.fn(),
	useSelect: jest.fn(),
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	store: {
		name: 'core',
	},
} ) );

jest.mock( '@wordpress/notices', () => ( {
	store: {
		name: 'notices',
	},
} ) );

jest.mock( '@wordpress/html-entities', () => ( {
	decodeEntities: jest.fn( ( text ) => text ),
} ) );

jest.mock( '@wordpress/i18n', () => ( {
	__: jest.fn( ( text ) => text ),
	sprintf: jest.fn( ( template, args ) => {
		if ( typeof template === 'string' && args ) {
			return template.replace( /\%\((\w+)\)s/g, ( _match, key ) => {
				return args[ key ] || _match;
			} );
		}
		return template;
	} ),
	isRTL: jest.fn( () => false ),
	_x: jest.fn( ( text ) => text ),
} ) );

const mockUseDispatch = useDispatch as jest.MockedFunction<
	typeof useDispatch
>;

// Mock theme data
const mockThemeWithUpdate: Theme = {
	...twentyeleven,
	version: '4.8',
	update_info: {
		has_update: true,
		current_version: '4.8',
		new_version: '4.9',
		update_url: 'https://wordpress.org/themes/twentyeleven/',
		package: 'https://downloads.wordpress.org/theme/twentyeleven.4.9.zip',
	},
};

const mockThemeWithoutUpdate = twentyeleven;

describe( 'updateTheme action', () => {
	const mockSaveEntityRecord = jest.fn();
	const mockCreateSuccessNotice = jest.fn();
	const mockCreateErrorNotice = jest.fn();

	beforeEach( () => {
		jest.clearAllMocks();

		mockUseDispatch.mockImplementation( ( storeName: any ) => {
			if ( storeName?.name === 'core' ) {
				return {
					saveEntityRecord: mockSaveEntityRecord,
				};
			}
			if ( storeName?.name === 'notices' ) {
				return {
					createSuccessNotice: mockCreateSuccessNotice,
					createErrorNotice: mockCreateErrorNotice,
				};
			}
			return {};
		} );

		mockSaveEntityRecord.mockResolvedValue( mockThemeWithoutUpdate );
		mockCreateSuccessNotice.mockResolvedValue( undefined );
		mockCreateErrorNotice.mockResolvedValue( undefined );
	} );

	describe( 'action configuration', () => {
		it( 'should be eligible for themes with updates', () => {
			expect( updateTheme.isEligible?.( mockThemeWithUpdate ) ).toBe(
				true
			);
		} );

		it( 'should not be eligible for themes without updates', () => {
			expect( updateTheme.isEligible?.( mockThemeWithoutUpdate ) ).toBe(
				false
			);
		} );
	} );

	describe( 'UpdateThemeModal component', () => {
		const TestModalComponent = ( {
			theme = mockThemeWithUpdate,
			closeModal = jest.fn(),
		}: {
			theme?: Theme;
			closeModal?: () => void;
		} ) => {
			const action = updateTheme;
			const ModalComponent = ( action as any ).RenderModal;

			return (
				<ModalComponent items={ [ theme ] } closeModal={ closeModal } />
			);
		};

		it( 'should render modal with theme update information', () => {
			render( <TestModalComponent /> );

			expect(
				screen.getByText(
					/Do you want to update the Twenty Eleven theme from version 4.8 to version 4.9\?/
				)
			).toBeInTheDocument();
		} );

		it( 'should render Cancel and Update buttons', () => {
			render( <TestModalComponent /> );

			expect(
				screen.getByRole( 'button', { name: 'Cancel' } )
			).toBeInTheDocument();
			expect(
				screen.getByRole( 'button', { name: 'Update' } )
			).toBeInTheDocument();
		} );

		it( 'should call closeModal when Cancel button is clicked', async () => {
			const mockCloseModal = jest.fn();
			render( <TestModalComponent closeModal={ mockCloseModal } /> );

			const cancelButton = screen.getByRole( 'button', {
				name: 'Cancel',
			} );
			await userEvent.click( cancelButton );

			expect( mockCloseModal ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'should handle theme update successfully', async () => {
			const mockCloseModal = jest.fn();
			render( <TestModalComponent closeModal={ mockCloseModal } /> );

			const updateButton = screen.getByRole( 'button', {
				name: 'Update',
			} );
			await userEvent.click( updateButton );

			await waitFor( () => {
				expect( mockSaveEntityRecord ).toHaveBeenCalledWith(
					'root',
					'theme',
					expect.objectContaining( {
						...mockThemeWithUpdate,
						version: '4.9',
					} ),
					{ throwOnError: true }
				);
			} );

			await waitFor( () => {
				expect( mockCreateSuccessNotice ).toHaveBeenCalledWith(
					'Theme Twenty Eleven updated to version 4.9.',
					{
						type: 'snackbar',
						id: 'update-theme-success-notice',
					}
				);
			} );

			expect( mockCloseModal ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'should handle theme update error with message', async () => {
			const errorMessage = 'Update failed due to network error';
			mockSaveEntityRecord.mockRejectedValue( {
				message: errorMessage,
			} );

			const mockCloseModal = jest.fn();
			render( <TestModalComponent closeModal={ mockCloseModal } /> );

			const updateButton = screen.getByRole( 'button', {
				name: 'Update',
			} );
			await userEvent.click( updateButton );

			await waitFor( () => {
				expect( mockCreateErrorNotice ).toHaveBeenCalledWith(
					`Theme Twenty Eleven update failed: ${ errorMessage }`,
					{ type: 'snackbar' }
				);
			} );

			expect( mockCloseModal ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'should handle theme update error without message', async () => {
			mockSaveEntityRecord.mockRejectedValue( {} );

			const mockCloseModal = jest.fn();
			render( <TestModalComponent closeModal={ mockCloseModal } /> );

			const updateButton = screen.getByRole( 'button', {
				name: 'Update',
			} );
			await userEvent.click( updateButton );

			await waitFor( () => {
				expect( mockCreateErrorNotice ).toHaveBeenCalledWith(
					'Theme Twenty Eleven update failed: Unknown error occurred',
					{ type: 'snackbar' }
				);
			} );

			expect( mockCloseModal ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'should disable buttons during update process', async () => {
			mockSaveEntityRecord.mockImplementation(
				() =>
					new Promise( ( resolve ) =>
						setTimeout( () => resolve( mockThemeWithUpdate ), 100 )
					)
			);

			render( <TestModalComponent /> );

			const updateButton = screen.getByRole( 'button', {
				name: 'Update',
			} );
			const cancelButton = screen.getByRole( 'button', {
				name: 'Cancel',
			} );

			await userEvent.click( updateButton );

			// Buttons should be disabled during update
			expect( updateButton ).toHaveAttribute( 'aria-disabled', 'true' );
			expect( cancelButton ).toHaveAttribute( 'aria-disabled', 'true' );

			await waitFor( () => {
				expect( mockSaveEntityRecord ).toHaveBeenCalled();
			} );
		} );
	} );
} );
