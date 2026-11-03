import { useDispatch } from '@wordpress/data';
import type { Theme } from '@wordpress/core-data';
import { decodeEntities } from '@wordpress/html-entities';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { theme as twentyeleven } from './__mocks__/theme';
import deleteTheme from '../delete-theme';

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
const mockDecodeEntities = decodeEntities as jest.MockedFunction<
	typeof decodeEntities
>;

describe( 'delete-theme', () => {
	const mockDeleteEntityRecord = jest.fn();
	const mockCreateSuccessNotice = jest.fn();
	const mockCreateErrorNotice = jest.fn();

	beforeEach( () => {
		jest.clearAllMocks();

		mockUseDispatch.mockImplementation( ( storeName: any ) => {
			if ( storeName?.name === 'core' ) {
				return {
					deleteEntityRecord: mockDeleteEntityRecord,
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

		mockDeleteEntityRecord.mockResolvedValue( undefined );
		mockCreateSuccessNotice.mockResolvedValue( undefined );
		mockCreateErrorNotice.mockResolvedValue( undefined );
	} );

	describe( 'deleteTheme', () => {
		it( 'should return isEligible false for active themes', () => {
			let action: any;
			const TestEligibilityComponent = () => {
				action = deleteTheme;
				return null;
			};

			render( <TestEligibilityComponent /> );

			const activeTheme = {
				...twentyeleven,
				status: 'active' as const,
				permissions: {
					delete: true,
				},
			};
			expect( action.isEligible( activeTheme ) ).toBe( false );
		} );

		it( 'should return isEligible true for inactive themes if user has theme delete capability', () => {
			let action: any;
			const TestEligibilityComponent = () => {
				action = deleteTheme;
				return null;
			};

			render( <TestEligibilityComponent /> );

			const inactiveTheme = {
				...twentyeleven,
				permissions: {
					// @ts-expect-error useEntityRecordsWithPermissions return type does not include the permissions property yet
					...twentyeleven.permissions,
					delete: true,
				},
				status: 'inactive' as const,
			};
			expect( action.isEligible( inactiveTheme ) ).toBe( true );
		} );

		it( 'should return isEligible false for inactive themes if user does not have theme delete capability', () => {
			let action: any;
			const TestEligibilityComponent = () => {
				action = deleteTheme;
				return null;
			};

			render( <TestEligibilityComponent /> );

			const inactiveTheme = {
				...twentyeleven,
				permissions: {
					// @ts-expect-error useEntityRecordsWithPermissions return type does not include the permissions property yet
					...twentyeleven.permissions,
					delete: false,
				},
				status: 'inactive' as const,
			};
			expect( action.isEligible( inactiveTheme ) ).toBe( false );
		} );
	} );

	describe( 'DeleteThemeModal', () => {
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
			const action = deleteTheme;
			const ModalComponent = ( action as any ).RenderModal;

			return (
				<ModalComponent items={ [ theme ] } closeModal={ closeModal } />
			);
		};

		it( 'should render modal with theme name', () => {
			render( <TestModalComponent /> );

			expect(
				screen.getByText(
					'Are you sure you want to delete the Twenty Eleven theme?'
				)
			).toBeInTheDocument();
		} );

		it( 'should render Cancel and Delete buttons', () => {
			render( <TestModalComponent /> );

			expect( screen.getByText( 'Cancel' ) ).toBeInTheDocument();
			expect( screen.getByText( 'Delete' ) ).toBeInTheDocument();
		} );

		it( 'should call closeModal when Cancel button is clicked', async () => {
			const mockCloseModal = jest.fn();
			render( <TestModalComponent closeModal={ mockCloseModal } /> );

			const cancelButton = screen.getByText( 'Cancel' );
			await userEvent.click( cancelButton );

			expect( mockCloseModal ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'should delete theme and show success notice when Delete button is clicked', async () => {
			const mockCloseModal = jest.fn();
			render( <TestModalComponent closeModal={ mockCloseModal } /> );

			const deleteButton = screen.getByText( 'Delete' );
			await userEvent.click( deleteButton );

			await waitFor( () => {
				expect( mockDeleteEntityRecord ).toHaveBeenCalledWith(
					'root',
					'theme',
					twentyeleven.stylesheet,
					{},
					{ throwOnError: true }
				);
			} );

			await waitFor( () => {
				expect( mockCreateSuccessNotice ).toHaveBeenCalledWith(
					'Theme Twenty Eleven deleted.',
					{
						type: 'snackbar',
						id: 'delete-theme-success-notice',
					}
				);
			} );

			expect( mockCloseModal ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'should show error notice when theme deletion fails', async () => {
			const mockError = {
				code: 'rest_theme_deletion_failed',
				message: 'Theme deletion failed',
				data: { status: 500 },
			};
			mockDeleteEntityRecord.mockRejectedValue( mockError );

			const mockCloseModal = jest.fn();
			render( <TestModalComponent closeModal={ mockCloseModal } /> );

			const deleteButton = screen.getByText( 'Delete' );
			await userEvent.click( deleteButton );

			await waitFor( () => {
				expect( mockCreateErrorNotice ).toHaveBeenCalledWith(
					'Theme Twenty Eleven deletion failed: Theme deletion failed',
					{ type: 'snackbar' }
				);
			} );

			expect( mockCloseModal ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'should handle error without message', async () => {
			const mockError = {
				code: 'rest_theme_deletion_failed',
				data: { status: 500 },
			};
			mockDeleteEntityRecord.mockRejectedValue( mockError );

			const mockCloseModal = jest.fn();
			render( <TestModalComponent closeModal={ mockCloseModal } /> );

			const deleteButton = screen.getByText( 'Delete' );
			await userEvent.click( deleteButton );

			await waitFor( () => {
				expect( mockCreateErrorNotice ).toHaveBeenCalledWith(
					'Theme Twenty Eleven deletion failed: Unknown error occurred',
					{ type: 'snackbar' }
				);
			} );
		} );

		it( 'should disable buttons during deletion', async () => {
			mockDeleteEntityRecord.mockImplementation(
				() =>
					new Promise( ( resolve ) =>
						setTimeout( () => resolve( twentyeleven ), 100 )
					)
			);

			render( <TestModalComponent /> );

			const deleteButton = screen.getByText( 'Delete' );
			const cancelButton = screen.getByText( 'Cancel' );

			await userEvent.click( deleteButton );

			expect( deleteButton ).toHaveAttribute( 'aria-disabled', 'true' );
			expect( cancelButton ).toHaveAttribute( 'aria-disabled', 'true' );

			await waitFor( () => {
				expect( mockDeleteEntityRecord ).toHaveBeenCalled();
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
					'Are you sure you want to delete the Theme & Style theme?'
				)
			).toBeInTheDocument();
		} );
	} );
} );
