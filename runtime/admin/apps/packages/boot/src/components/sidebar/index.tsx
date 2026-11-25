import { useState, useMemo } from 'react';
import { IconButton } from '@wordpress/ui';
// eslint-disable-next-line @spacepress-admin/design-system/use-new-components
import { Stack } from '@spacepress-admin/design-system';
import { __ } from '@wordpress/i18n';
import { useSelect } from '@wordpress/data';
import { help } from '@wordpress/icons';
import { store as spAdminStore } from '../../store';
import SidebarNavigationItem from '../sidebar-navigation-item';
import SidebarDrilldownItem from '../sidebar-drilldown-item';
import SidebarDropdownItem from '../sidebar-dropdown-item';
import SidebarSubmenuItem from '../sidebar-submenu-item';
import SidebarNavigationScreen from '../sidebar-navigation-screen';
import UserMenuButton from '../user-menu-button';
import SiteHub from '../site-hub';
import { useSidebarParent } from './use-sidebar-parent';
import { NudgeDisplay } from '../nudges';
import type { MenuItem } from '../../store/types';
import { ErrorBoundary } from '../error-boundary';
import './style.scss';
import MetaMenu from '../meta-menu';

const CANONICAL_SECTION_ORDER = [
	'home',
	'content',
	'commerce',
	'data',
	'site',
	'extensions',
];

const CANONICAL_SECTION_LABELS: Record< string, string > = {
	content: __( 'Content', 'spacepress-admin' ),
	commerce: __( 'Commerce', 'spacepress-admin' ),
	data: __( 'Data', 'spacepress-admin' ),
	site: __( 'Site', 'spacepress-admin' ),
	extensions: __( 'Extensions', 'spacepress-admin' ),
	system: __( 'System', 'spacepress-admin' ),
};

function formatSectionLabel( key: string, explicitLabel?: string ): string {
	if ( explicitLabel ) {
		return explicitLabel;
	}
	if ( key in CANONICAL_SECTION_LABELS ) {
		return CANONICAL_SECTION_LABELS[ key ];
	}
	return key
		.replace( /[-_]+/g, ' ' )
		.replace( /\b\w/g, ( ch ) => ch.toUpperCase() );
}

interface SidebarSectionGroup {
	key: string;
	label: string | null;
	items: MenuItem[];
}

function groupRootItems( items: MenuItem[] ): SidebarSectionGroup[] {
	const hasAnySection = items.some( ( item ) => Boolean( item.section ) );
	if ( ! hasAnySection ) {
		return [ { key: 'default', label: null, items } ];
	}

	const buckets = new Map< string, SidebarSectionGroup >();
	const customOrder: string[] = [];

	for ( const item of items ) {
		const rawSection = item.section?.trim() || 'home';
		const key = rawSection.toLowerCase();
		if ( ! buckets.has( key ) ) {
			const label =
				key === 'home'
					? null
					: formatSectionLabel( key, item.sectionLabel );
			buckets.set( key, { key, label, items: [] } );
			if (
				! CANONICAL_SECTION_ORDER.includes( key ) &&
				key !== 'system'
			) {
				customOrder.push( key );
			}
		}
		buckets.get( key )!.items.push( item );
	}

	const orderedKeys = [
		...CANONICAL_SECTION_ORDER,
		...customOrder,
		'system',
	];

	return orderedKeys
		.map( ( key ) => buckets.get( key ) )
		.filter(
			( group ): group is SidebarSectionGroup =>
				group !== undefined && group.items.length > 0
		);
}

function Sidebar() {
	const nudge = useSelect(
		( select ) => select( spAdminStore ).getCurrentNudge(),
		[]
	);
	const [ animationDirection, setAnimationDirection ] = useState<
		'forward' | 'backward' | null
	>( null );
	const [ parentId, setParentId, parentDropdownId, setParentDropdownId ] =
		useSidebarParent();
	const menuItems = useSelect(
		( select ) => select( spAdminStore ).getMenuItems(),
		[]
	);

	const parent = useMemo(
		() => menuItems.find( ( item ) => item.id === parentId ),
		[ menuItems, parentId ]
	);
	// Create a unique key for the current navigation state
	// The sidebar will animate when the key changes.
	const navigationKey = parent
		? `${ parent.parent_type }-${ parent.id }`
		: 'root';

	// We use transitions to handle navigation clicks
	// This allows smooth animations and non blocking navigation.
	const handleNavigate = ( {
		id,
		direction,
	}: {
		id?: string;
		direction: 'forward' | 'backward';
	} ) => {
		setAnimationDirection( direction );
		setParentId( id );
	};

	const handleDropdownToggle = ( dropdownId: string ) => {
		setParentDropdownId(
			parentDropdownId === dropdownId ? undefined : dropdownId
		);
	};

	const items = useMemo(
		() => menuItems.filter( ( item ) => item.parent === parentId ),
		[ menuItems, parentId ]
	);

	const hasRealIcons = items.some( ( item ) => !! item.icon );
	const backMenuItem = useMemo(
		() =>
			parent?.parent !== undefined
				? menuItems.find( ( { id } ) => id === parent.parent )
				: menuItems[ 0 ],
		[ parent, menuItems ]
	);


	const renderItem = ( item: MenuItem ) => {
		if ( item.parent_type === 'dropdown' ) {
			return (
				<SidebarDropdownItem
					key={ item.id }
					id={ item.id }
					className="spacepress-admin-sidebar-navigation-item"
					icon={ item.icon }
					badge={ item.badge }
					shouldShowPlaceholder={ hasRealIcons }
					isExpanded={ parentDropdownId === item.id }
					onToggle={ () => handleDropdownToggle( item.id ) }
				>
					{ item.label }
				</SidebarDropdownItem>
			);
		}

		if ( item.parent_type === 'drilldown' ) {
			return (
				<SidebarDrilldownItem
					key={ item.id }
					id={ item.id }
					icon={ item.icon }
					badge={ item.badge }
					shouldShowPlaceholder={ hasRealIcons }
					onNavigate={ handleNavigate }
				>
					{ item.label }
				</SidebarDrilldownItem>
			);
		}

		if ( item.parent_type === 'submenu' ) {
			return (
				<SidebarSubmenuItem
					key={ item.id }
					id={ item.id }
					to={ item.to }
					icon={ item.icon }
					badge={ item.badge }
					shouldShowPlaceholder={ hasRealIcons }
					onNavigate={ handleNavigate }
					className="spacepress-admin-sidebar-navigation-item"
				>
					{ item.label }
				</SidebarSubmenuItem>
			);
		}

		return (
			<SidebarNavigationItem
				key={ item.id }
				to={ item.to }
				icon={ item.icon }
				badge={ item.badge }
				shouldShowPlaceholder={ hasRealIcons }
			>
				{ item.label }
			</SidebarNavigationItem>
		);
	};

	const rootSections = useMemo(
		() => ( parent ? null : groupRootItems( items ) ),
		[ parent, items ]
	);

	return (
		<>
			<div className="spacepress-admin-sidebar__scrollable">
				<SiteHub />
				<div className="spacepress-admin-sidebar__content">
					<SidebarNavigationScreen
						isRoot={ ! parent }
						title={ parent ? parent.label : '' }
						backMenuItem={ backMenuItem }
						animationDirection={ animationDirection || undefined }
						navigationKey={ navigationKey }
						onNavigate={ handleNavigate }
						content={
							rootSections ? (
								<div className="spacepress-admin-sidebar__sections">
									{ rootSections.map( ( section ) => (
										<div
											key={ section.key }
											className="spacepress-admin-sidebar__section"
											data-section={ section.key }
										>
											{ section.label && (
												<div className="spacepress-admin-sidebar__section-label">
													{ section.label }
												</div>
											) }
											<div role="list">
												{ section.items.map(
													renderItem
												) }
											</div>
										</div>
									) ) }
								</div>
							) : (
								<div role="list">
									{ items.map( renderItem ) }
								</div>
							)
						}
					/>
				</div>

				{ /* Nudge area - only shows when there's a nudge */ }
				{ nudge && (
					<ErrorBoundary>
						<NudgeDisplay nudge={ nudge } />
					</ErrorBoundary>
				) }
				<Stack
					direction="column"
					gap={ 1 }
					className="spacepress-admin-sidebar__footer"
				>
					<Stack
						direction="row"
						align="center"
						justify="space-between"
					>
						<UserMenuButton />
						<Stack
							direction="row"
							gap={ 1 }
							justify="space-between"
							align="center"
						>
							<MetaMenu
								parent="wp-logo"
								icon={ help }
								label={ __( 'Help', 'spacepress-admin' ) }
							/>
						</Stack>
					</Stack>
				</Stack>
			</div>
		</>
	);
}

export default Sidebar;
