import { forwardRef } from 'react';
import { Link as DSLink } from '@wordpress/ui';
import { privateApis as routePrivateApis } from '@wordpress/route';
import type { LinkProps } from '@wordpress/route';
import { unlock } from '@first-admin/private-apis';

const { createLink } = unlock( routePrivateApis );

type DSLinkProps = React.ComponentProps< typeof DSLink >;

/**
 * Router Link with design system styling.
 */
export const RouterLink: React.ComponentType<
	DSLinkProps &
		Pick< LinkProps, 'to' | 'search' | 'params' | 'viewTransition' >
> = createLink(
	forwardRef< HTMLAnchorElement, DSLinkProps >(
		function RouterLink( props, ref ) {
			return <DSLink ref={ ref } { ...props } />;
		}
	)
);
