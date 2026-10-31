import {
	findClosestMenuItem,
	findDrilldownParent,
	findDropdownParent,
	findSubmenuParent,
} from '../path-matching';
import type { FlatMenuItem } from '../../../store/types';

describe( 'findClosestMenuItem', () => {
	const menuItems: FlatMenuItem[] = [
		{ id: 'dashboard', to: '/dashboard', label: 'Dashboard' },
		{ id: 'settings', to: '/settings', label: 'Settings' },
		{ id: 'woo', to: '/settings/woo', label: 'WooCommerce' },
		{ id: 'woo-orders', to: '/settings/woo/orders', label: 'Orders' },
		{ id: 'parent-no-to', to: '', label: 'Parent Without To' }, // Empty 'to' property
	];

	it( 'should return null when no matching segments found', () => {
		expect(
			findClosestMenuItem( '/completely/different/path', menuItems )
		).toBeNull();
	} );

	it( 'should return the item with most matching segments', () => {
		const result = findClosestMenuItem(
			'/settings/woo/orders/123',
			menuItems
		);
		expect( result ).toBe( menuItems[ 3 ] ); // woo-orders has 3 matching segments
	} );

	it( 'should prefer longer matches over shorter ones', () => {
		const result = findClosestMenuItem(
			'/settings/woo/something',
			menuItems
		);
		expect( result ).toBe( menuItems[ 2 ] ); // woo with 2 segments
	} );

	it( 'should handle exact matches', () => {
		const result = findClosestMenuItem( '/settings/woo', menuItems );
		expect( result ).toBe( menuItems[ 2 ] ); // woo
	} );

	it( 'should ignore menu items with empty "to" property', () => {
		const result = findClosestMenuItem( '/settings', menuItems );
		expect( result ).toBe( menuItems[ 1 ] ); // settings, not parent-no-to
	} );

	it( 'should not match when there are only partially matching paths', () => {
		const itemsWithSameCount: FlatMenuItem[] = [
			{ id: 'first', to: '/settings/general', label: 'General' },
			{ id: 'second', to: '/settings/privacy', label: 'Privacy' },
		];
		const result = findClosestMenuItem(
			'/settings/something',
			itemsWithSameCount
		);
		expect( result ).toBeNull();
	} );

	it( 'should handle empty menu items array', () => {
		expect( findClosestMenuItem( '/any/path', [] ) ).toBeNull();
	} );
} );

describe( 'findDrilldownParent', () => {
	const menuItems: FlatMenuItem[] = [
		{ id: 'root', to: '/', label: 'Root' },
		{
			id: 'settings',
			to: '/settings',
			label: 'Settings',
			parent: 'root',
			parent_type: 'drilldown',
		},
		{
			id: 'woo',
			to: '/settings/woo',
			label: 'WooCommerce',
			parent: 'settings',
		},
		{
			id: 'orders',
			to: '/settings/woo/orders',
			label: 'Orders',
			parent: 'woo',
		},
		{
			id: 'dropdown-parent',
			to: '',
			label: 'Dropdown Parent',
			parent_type: 'dropdown',
		},
		{
			id: 'dropdown-child',
			to: '/dropdown/child',
			label: 'Dropdown Child',
			parent: 'dropdown-parent',
		},
	];

	it( 'should return undefined for non-existent item', () => {
		expect(
			findDrilldownParent( 'non-existent', menuItems )
		).toBeUndefined();
	} );

	it( 'should return undefined for undefined id', () => {
		expect( findDrilldownParent( undefined, menuItems ) ).toBeUndefined();
	} );

	it( 'should return the direct drilldown parent', () => {
		expect( findDrilldownParent( 'woo', menuItems ) ).toBe( 'settings' );
	} );

	it( 'should traverse up to find drilldown parent', () => {
		expect( findDrilldownParent( 'orders', menuItems ) ).toBe( 'settings' );
	} );

	it( 'should return undefined for item without drilldown parent', () => {
		expect(
			findDrilldownParent( 'dropdown-child', menuItems )
		).toBeUndefined();
	} );

	it( 'should return undefined for root item', () => {
		expect( findDrilldownParent( 'root', menuItems ) ).toBeUndefined();
	} );

	it( 'should handle item with parent that does not exist', () => {
		const itemsWithOrphan: FlatMenuItem[] = [
			...menuItems,
			{
				id: 'orphan',
				to: '/orphan',
				label: 'Orphan',
				parent: 'missing-parent',
			},
		];
		expect(
			findDrilldownParent( 'orphan', itemsWithOrphan )
		).toBeUndefined();
	} );
} );

describe( 'findDropdownParent', () => {
	const menuItems: FlatMenuItem[] = [
		{ id: 'root', to: '/', label: 'Root' },
		{
			id: 'dropdown-parent',
			to: '',
			label: 'Dropdown Parent',
			parent_type: 'dropdown',
		},
		{
			id: 'dropdown-child',
			to: '/dropdown/child',
			label: 'Dropdown Child',
			parent: 'dropdown-parent',
		},
		{
			id: 'drilldown-parent',
			to: '/drilldown',
			label: 'Drilldown Parent',
			parent: 'root',
			parent_type: 'drilldown',
		},
		{
			id: 'drilldown-child',
			to: '/drilldown/child',
			label: 'Drilldown Child',
			parent: 'drilldown-parent',
		},
	];

	it( 'should return undefined for non-existent item', () => {
		expect(
			findDropdownParent( 'non-existent', menuItems )
		).toBeUndefined();
	} );

	it( 'should return undefined for undefined id', () => {
		expect( findDropdownParent( undefined, menuItems ) ).toBeUndefined();
	} );

	it( 'should return the dropdown parent', () => {
		expect( findDropdownParent( 'dropdown-child', menuItems ) ).toBe(
			'dropdown-parent'
		);
	} );

	it( 'should return undefined for item with drilldown parent', () => {
		expect(
			findDropdownParent( 'drilldown-child', menuItems )
		).toBeUndefined();
	} );

	it( 'should return undefined for root item', () => {
		expect( findDropdownParent( 'root', menuItems ) ).toBeUndefined();
	} );

	it( 'should return undefined for item without parent', () => {
		expect(
			findDropdownParent( 'dropdown-parent', menuItems )
		).toBeUndefined();
	} );

	it( 'should handle item with parent that does not exist', () => {
		const itemsWithOrphan: FlatMenuItem[] = [
			...menuItems,
			{
				id: 'orphan',
				to: '/orphan',
				label: 'Orphan',
				parent: 'missing-parent',
			},
		];
		expect(
			findDropdownParent( 'orphan', itemsWithOrphan )
		).toBeUndefined();
	} );
} );

describe( 'findSubmenuParent', () => {
	it( 'should return undefined for undefined id', () => {
		expect( findSubmenuParent( undefined, [] ) ).toBeUndefined();
	} );

	it( 'should return undefined for non-existent item', () => {
		const menuItems: FlatMenuItem[] = [
			{ id: 'item1', to: '/item1', label: 'Item 1' },
		];
		expect(
			findSubmenuParent( 'non-existent', menuItems )
		).toBeUndefined();
	} );

	it( 'should return the item id if it is itself a submenu', () => {
		const menuItems: FlatMenuItem[] = [
			{
				id: 'submenu',
				to: '/submenu',
				label: 'Submenu',
				parent_type: 'submenu',
			},
		];
		expect( findSubmenuParent( 'submenu', menuItems ) ).toBe( 'submenu' );
	} );

	it( 'should return the direct submenu parent', () => {
		const menuItems: FlatMenuItem[] = [
			{
				id: 'parent',
				to: '/parent',
				label: 'Parent',
				parent_type: 'submenu',
			},
			{
				id: 'child',
				to: '/child',
				label: 'Child',
				parent: 'parent',
			},
		];
		expect( findSubmenuParent( 'child', menuItems ) ).toBe( 'parent' );
	} );

	it( 'should traverse up multiple levels to find submenu parent', () => {
		const menuItems: FlatMenuItem[] = [
			{
				id: 'parent',
				to: '/parent',
				label: 'Parent',
				parent_type: 'submenu',
			},
			{
				id: 'child',
				to: '/child',
				label: 'Child',
				parent: 'parent',
			},
			{
				id: 'grandchild',
				to: '/grandchild',
				label: 'Grandchild',
				parent: 'child',
			},
		];
		expect( findSubmenuParent( 'grandchild', menuItems ) ).toBe( 'parent' );
	} );

	it( 'should handle nested submenu (submenu within submenu)', () => {
		const menuItems: FlatMenuItem[] = [
			{
				id: 'outer-submenu',
				to: '/outer',
				label: 'Outer Submenu',
				parent_type: 'submenu',
			},
			{
				id: 'inner-submenu',
				to: '/inner',
				label: 'Inner Submenu',
				parent: 'outer-submenu',
				parent_type: 'submenu',
			},
			{
				id: 'child',
				to: '/child',
				label: 'Child',
				parent: 'inner-submenu',
			},
		];
		expect( findSubmenuParent( 'child', menuItems ) ).toBe(
			'inner-submenu'
		);
	} );

	it( 'should handle deeply nested submenu (three levels)', () => {
		const menuItems: FlatMenuItem[] = [
			{
				id: 'level1',
				to: '/level1',
				label: 'Level 1',
				parent_type: 'submenu',
			},
			{
				id: 'level2',
				to: '/level2',
				label: 'Level 2',
				parent: 'level1',
				parent_type: 'submenu',
			},
			{
				id: 'level3',
				to: '/level3',
				label: 'Level 3',
				parent: 'level2',
				parent_type: 'submenu',
			},
			{
				id: 'child',
				to: '/child',
				label: 'Child',
				parent: 'level3',
			},
		];
		expect( findSubmenuParent( 'child', menuItems ) ).toBe( 'level3' );
	} );

	it( 'should return undefined when no submenu parent exists', () => {
		const menuItems: FlatMenuItem[] = [
			{ id: 'item1', to: '/item1', label: 'Item 1' },
			{
				id: 'item2',
				to: '/item2',
				label: 'Item 2',
				parent: 'item1',
			},
		];
		expect( findSubmenuParent( 'item2', menuItems ) ).toBeUndefined();
	} );

	it( 'should return undefined for items with drilldown parent only', () => {
		const menuItems: FlatMenuItem[] = [
			{
				id: 'parent',
				to: '/parent',
				label: 'Parent',
				parent_type: 'drilldown',
			},
			{
				id: 'child',
				to: '/child',
				label: 'Child',
				parent: 'parent',
			},
		];
		expect( findSubmenuParent( 'child', menuItems ) ).toBeUndefined();
	} );

	it( 'should return undefined for items with dropdown parent only', () => {
		const menuItems: FlatMenuItem[] = [
			{
				id: 'parent',
				to: '/parent',
				label: 'Parent',
				parent_type: 'dropdown',
			},
			{
				id: 'child',
				to: '/child',
				label: 'Child',
				parent: 'parent',
			},
		];
		expect( findSubmenuParent( 'child', menuItems ) ).toBeUndefined();
	} );

	it( 'should traverse through non-submenu items to find submenu parent', () => {
		const menuItems: FlatMenuItem[] = [
			{
				id: 'submenu-parent',
				to: '/submenu',
				label: 'Submenu Parent',
				parent_type: 'submenu',
			},
			{
				id: 'regular1',
				to: '/regular1',
				label: 'Regular 1',
				parent: 'submenu-parent',
			},
			{
				id: 'regular2',
				to: '/regular2',
				label: 'Regular 2',
				parent: 'regular1',
			},
			{
				id: 'regular3',
				to: '/regular3',
				label: 'Regular 3',
				parent: 'regular2',
			},
		];
		expect( findSubmenuParent( 'regular3', menuItems ) ).toBe(
			'submenu-parent'
		);
	} );

	it( 'should return undefined when parent does not exist', () => {
		const menuItems: FlatMenuItem[] = [
			{
				id: 'orphan',
				to: '/orphan',
				label: 'Orphan',
				parent: 'missing-parent',
			},
		];
		expect( findSubmenuParent( 'orphan', menuItems ) ).toBeUndefined();
	} );
} );
