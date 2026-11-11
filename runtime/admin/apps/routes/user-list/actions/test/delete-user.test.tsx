import type { User } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useViewConfig } from '@first-admin/views';
import { useTrackedModal } from '@first-admin/telemetry';
import { useDeleteUser } from '../../../user/hooks';
import { useDeleteUserAction } from '../delete-user';

jest.mock( '@first-admin/views', () => ( {
	useViewConfig: jest.fn(),
} ) );

jest.mock( '@first-admin/telemetry', () => ( {
	useTrackedModal: jest.fn(),
} ) );

jest.mock( '@wordpress/components', () => ( {
	Button: ( {
		children,
		onClick,
		disabled,
	}: {
		children: React.ReactNode;
		onClick?: () => void;
		disabled?: boolean;
	} ) => (
		<button onClick={ onClick } disabled={ disabled }>
			{ children }
		</button>
	),
	__experimentalHStack: ( { children }: { children: React.ReactNode } ) => (
		<div>{ children }</div>
	),
	__experimentalText: ( { children }: { children: React.ReactNode } ) => (
		<p>{ children }</p>
	),
	__experimentalVStack: ( { children }: { children: React.ReactNode } ) => (
		<div>{ children }</div>
	),
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	store: {
		name: 'core',
	},
} ) );

jest.mock( '@wordpress/data', () => ( {
	useSelect: jest.fn(),
} ) );

jest.mock( '@wordpress/i18n', () => ( {
	__: jest.fn( ( text ) => text ),
	sprintf: jest.fn( ( template, ...args: Array< string | number > ) => {
		let formatted = template;
		args.forEach( ( arg ) => {
			formatted = formatted.replace( /%(\d+\$)?[sd]/, String( arg ) );
		} );
		return formatted;
	} ),
} ) );

jest.mock( '@wordpress/icons', () => ( {
	trash: {},
} ) );

jest.mock( '../../../user/hooks', () => ( {
	useDeleteUser: jest.fn(),
} ) );

const mockUseDeleteUser = useDeleteUser as jest.MockedFunction<
	typeof useDeleteUser
>;
const mockUseSelect = useSelect as jest.MockedFunction< typeof useSelect >;
const mockUseTrackedModal = useTrackedModal as jest.MockedFunction<
	typeof useTrackedModal
>;
const mockUseViewConfig = useViewConfig as jest.MockedFunction<
	typeof useViewConfig
>;

describe( 'useDeleteUserAction', () => {
	const trackedModal = {
		trackButtonClick: jest.fn(),
		trackButtonError: jest.fn(),
		trackClose: jest.fn(),
		trackLinkClick: jest.fn(),
		trackOpenChange: jest.fn(),
		trackRequestClose: jest.fn(),
	};
	const deleteUsers = jest.fn();
	const user = {
		id: 24,
		name: 'Alex Example',
		email: 'alex@example.com',
	} as User;

	beforeEach( () => {
		jest.clearAllMocks();

		mockUseViewConfig.mockReturnValue( {
			actions: [ 'delete' ],
		} as ReturnType< typeof useViewConfig > );

		mockUseTrackedModal.mockReturnValue( trackedModal );

		mockUseSelect.mockImplementation( ( mapSelect ) =>
			mapSelect( () => ( {
				canUser: jest.fn( () => true ),
				getCurrentUser: jest.fn( () => ( { id: 99 } ) ),
				getUser: jest.fn( () => ( {
					id: 1,
					name: 'Store Owner',
					email: 'owner@example.com',
				} ) ),
			} ) )
		);

		mockUseDeleteUser.mockReturnValue( {
			deleteUsers,
			isBusy: false,
		} );
	} );

	function renderDeleteModal( {
		closeModal = jest.fn(),
		onActionPerformed = jest.fn(),
	}: {
		closeModal?: () => void;
		onActionPerformed?: ( items: User[] ) => void;
	} = {} ) {
		let action: ReturnType< typeof useDeleteUserAction > = null;

		function TestComponent() {
			action = useDeleteUserAction();
			if ( ! action ) {
				return null;
			}

			const ModalComponent = action.RenderModal;
			return (
				<ModalComponent
					items={ [ user ] }
					closeModal={ closeModal }
					onActionPerformed={ onActionPerformed }
				/>
			);
		}

		const renderResult = render( <TestComponent /> );

		return {
			action,
			closeModal,
			onActionPerformed,
			...renderResult,
		};
	}

	it( 'tracks and closes the list delete modal when cancel is clicked', async () => {
		const { closeModal } = renderDeleteModal();

		await userEvent.click(
			screen.getByRole( 'button', { name: 'Cancel' } )
		);

		expect( trackedModal.trackButtonClick ).toHaveBeenCalledWith(
			'cancel'
		);
		expect( closeModal ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'tracks and deletes users from the list delete modal when confirmed', async () => {
		renderDeleteModal();

		await userEvent.click(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		);

		expect( trackedModal.trackButtonClick ).toHaveBeenCalledWith(
			'delete_permanently'
		);
		await waitFor( () => {
			expect( deleteUsers ).toHaveBeenCalledWith( [ user ] );
		} );
	} );

	it( 'tracks a modal close when the DataViews shell dismisses the modal', () => {
		const { unmount } = renderDeleteModal();

		unmount();

		expect( trackedModal.trackClose ).toHaveBeenCalledWith( 'unknown' );
	} );
} );
