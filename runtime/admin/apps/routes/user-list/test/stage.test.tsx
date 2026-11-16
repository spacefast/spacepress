import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Content from '../stage';

const mockUseTrackedDataView = jest.fn();
const mockNavigate = jest.fn();
const mockTabClick = jest.fn();

jest.mock( '@wordpress/route', () => ( {
	useNavigate: () => mockNavigate,
	useSearch: () => ( {} ),
	useParams: () => ( { slug: 'all' } ),
	useInvalidate: () => jest.fn(),
	Link: ( { children }: { children: React.ReactNode } ) => children,
} ) );

jest.mock( '@typedpress-admin/views', () => ( {
	DataViews: ( { tabs }: { tabs?: React.ReactNode } ) => (
		<div>
			{ tabs }
			<div data-testid="dataviews" />
		</div>
	),
	useView: () => ( {
		view: {
			type: 'table',
			fields: [],
			filters: [],
			page: 1,
			perPage: 20,
			search: '',
			sort: {},
		},
		isModified: false,
		updateView: jest.fn(),
		resetToDefault: jest.fn(),
	} ),
	useViewConfig: () => ( {
		viewConfig: {},
		labels: {
			title: 'Users',
		},
		defaultLayouts: undefined,
	} ),
} ) );

jest.mock( '@typedpress-admin/core-data-next', () => ( {
	useFieldCollections: () => [],
} ) );

jest.mock( '@typedpress-admin/admin-toolkit', () => ( {
	Page: ( { children }: { children: React.ReactNode } ) => (
		<div>{ children }</div>
	),
	unlock: () => ( {
		useEntityRecordsWithPermissions: () => ( {
			records: [],
			totalItems: 0,
			totalPages: null,
			isResolving: false,
		} ),
	} ),
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	store: 'core',
	privateApis: 'core-data-private-apis',
} ) );

jest.mock( '@wordpress/data', () => ( {
	useSelect: (
		selector: ( select: ( store: string ) => unknown ) => unknown
	) =>
		selector( () => ( {
			canUser: () => true,
		} ) ),
} ) );

jest.mock( '@wordpress/components', () => ( {
	Button: ( { children }: { children: React.ReactNode } ) => (
		<button>{ children }</button>
	),
} ) );

jest.mock( '@typedpress-admin/telemetry', () => ( {
	normalizeLabel: ( value: string ) => value,
	serializeFilters: () => '',
	usePageView: jest.fn(),
	useTrack: () => ( { tabClick: mockTabClick } ),
	useTrackedDataView: (
		_view: unknown,
		context: Record< string, unknown >
	) => {
		mockUseTrackedDataView( context );
		return {
			onViewChange: jest.fn(),
			resetView: jest.fn(),
			withActionTracking: ( actions: unknown ) => actions,
		};
	},
} ) );

jest.mock( '../actions/full-edit', () => ( {
	useFullEditAction: () => ( {
		id: 'edit',
		callback: jest.fn(),
	} ),
} ) );

jest.mock( '../actions/quick-edit', () => ( {
	useQuickEditAction: () => ( {
		id: 'quick-edit',
		callback: jest.fn(),
	} ),
} ) );

jest.mock( '../actions/delete-user', () => ( {
	useDeleteUserAction: () => ( {
		id: 'delete',
		callback: jest.fn(),
	} ),
} ) );

jest.mock( '../actions/update-role', () => ( {
	useUpdateUserRoleAction: () => ( {
		id: 'update-role',
		callback: jest.fn(),
	} ),
} ) );

jest.mock( '../role-tabs', () => ( {
	RoleTabs: ( { onChange }: { onChange: ( role: string ) => void } ) => (
		<button onClick={ () => onChange( 'shop_manager' ) }>Switch tab</button>
	),
} ) );

jest.mock( '../empty-state', () => ( {
	UserListEmptyState: () => null,
} ) );

jest.mock( '../view-utils', () => ( {
	getDefaultView: () => ( {
		type: 'table',
		fields: [],
		filters: [],
		page: 1,
		perPage: 20,
		search: '',
		sort: {},
	} ),
	viewToQuery: () => ( {} ),
} ) );

jest.mock( '../style.scss', () => ( {} ) );

describe( 'UserList telemetry wiring', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'preserves null totalPages for DataView tracking while results are stale', () => {
		render( <Content /> );

		expect( mockUseTrackedDataView ).toHaveBeenCalledWith(
			expect.objectContaining( {
				totalPages: null,
			} )
		);
	} );

	it( 'preserves null totalPages when tracking a tab click during stale results', async () => {
		const user = userEvent.setup();

		render( <Content /> );

		await user.click(
			screen.getByRole( 'button', { name: 'Switch tab' } )
		);

		expect( mockTabClick ).toHaveBeenCalledWith(
			'all',
			'shop_manager',
			expect.objectContaining( {
				total_pages: null,
			} )
		);
	} );
} );
