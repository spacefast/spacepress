import { privateApis as routePrivateApis } from '@wordpress/route';
import type { ComponentProps, ForwardedRef, ComponentType } from 'react';
import { forwardRef } from 'react';
import { __experimentalItem as Item } from '@wordpress/components';
import { unlock } from '@first-admin/admin-toolkit';

const { createLink } = unlock( routePrivateApis );

type ItemProps = ComponentProps< typeof Item >;

function AnchorOnlyItem(
	props: ItemProps,
	forwardedRef: ForwardedRef< HTMLAnchorElement >
): JSX.Element {
	return <Item as="a" ref={ forwardedRef } { ...props } />;
}

const AnchorOnlyItemWithRef = forwardRef( AnchorOnlyItem );

// Using ComponentType to avoid referencing internal WordPress component types
// This is the minimal type annotation needed for portability
const RouterLinkItem = createLink(
	AnchorOnlyItemWithRef as unknown as ComponentType<
		Record< string, unknown >
	>
) as unknown as ComponentType< ItemProps & { to: string } >;

export default RouterLinkItem;
