import { useDispatch, useSelect } from '@wordpress/data';
import type { Theme } from '@wordpress/core-data';
import { decodeEntities } from '@wordpress/html-entities';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { theme as twentyeleven } from './__mocks__/theme';
import activateTheme from '../activate-theme';

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
const mockUseSelect = useSelect as jest.MockedFunction< typeof useSelect >;
const mockDecodeEntities = decodeEntities as jest.MockedFunction<
	typeof decodeEntities
>;

describe( 'activate-theme', () => {
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

		mockUseSelect.mockReturnValue( {
			homeUrl: 'https://example.com',
		} );

		mockSaveEntityRecord.mockResolvedValue( twentyeleven );
		mockCreateSuccessNotice.mockResolvedValue( undefined );
		mockCreateErrorNotice.mockResolvedValue( undefined );
	} );

	describe( 'activateTheme', () => {
		it( 'should return isEligible false for active themes', () => {
			let action: any;
			const TestEligibilityComponent = () => {
				action = activateTheme;
				return null;
			};

			render( <TestEligibilityComponent /> );

			const activeTheme = { ...twentyeleven, status: 'active' as const };
			expect( action.isEligible( activeTheme ) ).toBe( false );
		} );

		it( 'should return isEligible true for inactive themes if user has theme update capability', () => {
			let action: any;
			const TestEligibilityComponent = () => {
				action = activateTheme;
				return null;
			};

			render( <TestEligibilityComponent /> );

			const inactiveTheme = {
				...twentyeleven,
				permissions: {
					// @ts-expect-error useEntityRecordsWithPermissions return type does not include the permissions property yet
					...twentyeleven.permissions,
					update: true,
				},
				status: 'inactive' as const,
			};
			expect( action.isEligible( inactiveTheme ) ).toBe( true );
		} );

		it( 'should return isEligible true for inactive themes if user does not have theme update capability', () => {
			let action: any;
			const TestEligibilityComponent = () => {
				action = activateTheme;
				return null;
			};

			render( <TestEligibilityComponent /> );

			const inactiveTheme = {
				...twentyeleven,
				permissions: {
					// @ts-expect-error useEntityRecordsWithPermissions return type does not include the permissions property yet
					...twentyeleven.permissions,
					update: false,
				},
				status: 'inactive' as const,
			};
			expect( action.isEligible( inactiveTheme ) ).toBe( false );
		} );
	} );

	describe( 'ActivateThemeModal', () => {
		const TestModalComponent = ( {
			theme = {
				...twentyeleven,
				status: 'inactive' as const,
			},
			closeModal = jest.fn(),
		}: {
			theme?: Theme;
			closeModal?: () => void;
		} ) => {
			const action = activateTheme;
			const ModalComponent = ( action as any ).RenderModal;

			return (
				<ModalComponent items={ [ theme ] } closeModal={ closeModal } />
			);
		};

		it( 'should render modal with theme name', () => {
			render( <TestModalComponent /> );

			expect(
				screen.getByText(
					'Do you want to activate the Twenty Eleven theme?'
				)
			).toBeInTheDocument();
		} );

		it( 'should render Cancel and Activate buttons', () => {
			render( <TestModalComponent /> );

			expect( screen.getByText( 'Cancel' ) ).toBeInTheDocument();
			expect( screen.getByText( 'Activate' ) ).toBeInTheDocument();
		} );

		it( 'should call closeModal when Cancel button is clicked', async () => {
			const mockCloseModal = jest.fn();
			render( <TestModalComponent closeModal={ mockCloseModal } /> );

			const cancelButton = screen.getByText( 'Cancel' );
			await userEvent.click( cancelButton );

			expect( mockCloseModal ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'should activate theme and show success notice when Activate button is clicked', async () => {
			const mockCloseModal = jest.fn();
			render( <TestModalComponent closeModal={ mockCloseModal } /> );

			const activateButton = screen.getByText( 'Activate' );
			await userEvent.click( activateButton );

			await waitFor( () => {
				expect( mockSaveEntityRecord ).toHaveBeenCalledWith(
					'root',
					'theme',
					expect.objectContaining( {
						...twentyeleven,
						status: 'active',
					} ),
					{ throwOnError: true }
				);
			} );

			await waitFor( () => {
				expect( mockCreateSuccessNotice ).toHaveBeenCalledWith(
					'Theme Twenty Eleven activated.',
					{
						type: 'snackbar',
						id: 'activate-theme-success-notice',
						actions: [
							{
								label: 'Visit site',
								url: 'https://example.com',
								variant: 'link',
							},
						],
					}
				);
			} );

			expect( mockCloseModal ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'should show error notice when theme activation fails', async () => {
			const mockError = {
				code: 'rest_theme_activation_failed',
				message: 'Theme activation failed',
				data: { status: 500 },
			};
			mockSaveEntityRecord.mockRejectedValue( mockError );

			const mockCloseModal = jest.fn();
			render( <TestModalComponent closeModal={ mockCloseModal } /> );

			const activateButton = screen.getByText( 'Activate' );
			await userEvent.click( activateButton );

			await waitFor( () => {
				expect( mockCreateErrorNotice ).toHaveBeenCalledWith(
					'Theme Twenty Eleven activation failed: Theme activation failed',
					{ type: 'snackbar' }
				);
			} );

			expect( mockCloseModal ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'should handle error without message', async () => {
			const mockError = {
				code: 'rest_theme_activation_failed',
				data: { status: 500 },
			};
			mockSaveEntityRecord.mockRejectedValue( mockError );

			const mockCloseModal = jest.fn();
			render( <TestModalComponent closeModal={ mockCloseModal } /> );

			const activateButton = screen.getByText( 'Activate' );
			await userEvent.click( activateButton );

			await waitFor( () => {
				expect( mockCreateErrorNotice ).toHaveBeenCalledWith(
					'Theme Twenty Eleven activation failed: Unknown error occurred',
					{ type: 'snackbar' }
				);
			} );
		} );

		it( 'should disable buttons during activation', async () => {
			mockSaveEntityRecord.mockImplementation(
				() =>
					new Promise( ( resolve ) =>
						setTimeout( () => resolve( twentyeleven ), 100 )
					)
			);

			render( <TestModalComponent /> );

			const activateButton = screen.getByText( 'Activate' );
			const cancelButton = screen.getByText( 'Cancel' );

			await userEvent.click( activateButton );

			expect( activateButton ).toHaveAttribute( 'aria-disabled', 'true' );
			expect( cancelButton ).toHaveAttribute( 'aria-disabled', 'true' );

			await waitFor( () => {
				expect( mockSaveEntityRecord ).toHaveBeenCalled();
			} );
		} );

		it( 'should decode HTML entities in theme name', () => {
			const themeWithEntities = {
				...twentyeleven,
				name: {
					rendered: 'Theme &amp; Style',
					raw: 'Theme &amp; Style',
				},
			} as unknown as Theme;

			mockDecodeEntities.mockReturnValue( 'Theme & Style' );

			render( <TestModalComponent theme={ themeWithEntities } /> );

			expect( mockDecodeEntities ).toHaveBeenCalledWith(
				'Theme &amp; Style'
			);
			expect(
				screen.getByText(
					'Do you want to activate the Theme & Style theme?'
				)
			).toBeInTheDocument();
		} );
	} );
} );
