import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Content from '../stage';

const mockRecordTracksEvent = jest.fn();
const mockButtonClick = jest.fn();

jest.mock( '@first-admin/core-data-next', () => ( {
	useFieldCollections: () => [ { id: 'email', label: 'Email' } ],
} ) );

jest.mock( '@first-admin/views', () => ( {
	useViewConfig: () => ( {
		editForm: {},
		viewConfig: {},
	} ),
} ) );

jest.mock( '@first-admin/admin-toolkit', () => {
	function Menu( { children }: { children: React.ReactNode } ) {
		return <div>{ children }</div>;
	}

	function MenuTriggerButton( {
		render: renderedElement,
	}: {
		render: React.ReactElement;
	} ) {
		return renderedElement;
	}

	function MenuPopover( { children }: { children: React.ReactNode } ) {
		return <div>{ children }</div>;
	}

	function MenuItem( {
		children,
		onClick,
	}: {
		children: React.ReactNode;
		onClick?: () => void;
	} ) {
		return <button onClick={ onClick }>{ children }</button>;
	}

	function MenuItemLabel( { children }: { children: React.ReactNode } ) {
		return <>{ children }</>;
	}

	Menu.TriggerButton = MenuTriggerButton;
	Menu.Popover = MenuPopover;
	Menu.Item = MenuItem;
	Menu.ItemLabel = MenuItemLabel;

	function Page( {
		children,
		actions,
	}: {
		children: React.ReactNode;
		actions?: React.ReactNode;
	} ) {
		return (
			<div>
				<div>{ actions }</div>
				<div>{ children }</div>
			</div>
		);
	}

	function Breadcrumbs( { items }: { items: Array< { label: string } > } ) {
		return <div>{ items.map( ( item ) => item.label ).join( ' / ' ) }</div>;
	}

	function Badge( { children }: { children: React.ReactNode } ) {
		return <span>{ children }</span>;
	}

	Page.Breadcrumbs = Breadcrumbs;

	return {
		Page,
		unlock: () => ( {
			Badge,
			Menu,
		} ),
	};
} );

jest.mock( '@wordpress/route', () => ( {
	useParams: () => ( { userId: '2' } ),
	useNavigate: () => jest.fn(),
} ) );

jest.mock( '@wordpress/html-entities', () => ( {
	decodeEntities: ( value: string ) => value,
} ) );

jest.mock( '@wordpress/i18n', () => ( {
	__: ( value: string ) => value,
	sprintf: ( value: string ) => value,
} ) );

jest.mock( '@first-admin/boot', () => ( {
	store: 'first-admin-store',
} ) );

jest.mock( '@wordpress/data', () => ( {
	select: ( storeName: string ) => {
		if ( storeName === 'core-store' ) {
			return {
				getEditedEntityRecord: () => ( {
					id: 2,
					email: 'teammate@example.com',
					roles: [ 'administrator' ],
				} ),
			};
		}

		return {
			getDashboardContext: () => ( {
				partner: null,
			} ),
		};
	},
	useSelect: (
		selector: ( select: ( store: string ) => unknown ) => unknown
	) =>
		selector( ( storeName: string ) => {
			if ( storeName === 'core-store' ) {
				return {
					getCurrentUser: () => ( {
						id: 1,
					} ),
				};
			}

			return {
				getDashboardContext: () => ( {
					partner: null,
				} ),
			};
		} ),
	useDispatch: () => ( {
		editEntityRecord: jest.fn(),
		saveEditedEntityRecord: jest.fn(),
		createSuccessNotice: jest.fn(),
		createErrorNotice: jest.fn(),
		removeNotice: jest.fn(),
	} ),
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	store: 'core-store',
} ) );

jest.mock( '@wordpress/notices', () => ( {
	store: 'notices-store',
} ) );

jest.mock( '@wordpress/components', () => {
	function Grid( { children }: { children: React.ReactNode } ) {
		return <div>{ children }</div>;
	}

	function VStack( { children }: { children: React.ReactNode } ) {
		return <div>{ children }</div>;
	}

	function HStack( { children }: { children: React.ReactNode } ) {
		return <div>{ children }</div>;
	}

	return {
		__experimentalGrid: Grid,
		__experimentalVStack: VStack,
		__experimentalHStack: HStack,
		Button: ( {
			children,
			onClick,
			label,
		}: {
			children?: React.ReactNode;
			onClick?: () => void;
			label?: string;
		} ) => (
			<button onClick={ onClick } aria-label={ label }>
				{ children ?? label }
			</button>
		),
		privateApis: 'components-private-apis',
	};
} );

jest.mock( '@wordpress/icons', () => ( {
	moreVertical: {},
	arrowUpRight: {},
} ) );

jest.mock( '@first-admin/dataviews', () => ( {
	DataForm: () => <div>DataForm</div>,
} ) );

jest.mock( '@first-admin/telemetry', () => ( {
	useTrack: () => ( {
		buttonClick: mockButtonClick,
		buttonError: jest.fn(),
	} ),
	recordTracksEvent: (
		eventName: string,
		props: Record< string, unknown >
	) => mockRecordTracksEvent( eventName, props ),
} ) );

jest.mock( '../../user/utils', () => ( {
	isInviteUser: () => false,
	isPendingInvite: () => false,
	isStoreOwner: () => false,
	getUserDisplayName: () => 'Teammate',
	isInInviteMode: () => false,
} ) );

jest.mock( '../../user/components/delete-user-modal', () => ( {
	DeleteUserModal: ( { isOpen }: { isOpen: boolean } ) =>
		isOpen ? <div>Delete modal</div> : null,
} ) );

jest.mock( '../style.scss', () => ( {} ) );

describe( 'User profile delete telemetry', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'does not emit menu_item_click when opening the delete modal', async () => {
		const user = userEvent.setup();

		render( <Content /> );

		await user.click( screen.getByRole( 'button', { name: 'Actions' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Delete' } ) );

		expect( mockButtonClick ).not.toHaveBeenCalledWith( 'delete' );
		expect( mockRecordTracksEvent ).not.toHaveBeenCalled();
		expect( screen.getByText( 'Delete modal' ) ).toBeInTheDocument();
	} );
} );
