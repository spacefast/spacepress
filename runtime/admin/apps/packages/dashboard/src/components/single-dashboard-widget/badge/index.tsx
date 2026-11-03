import { useMemo } from 'react';
// eslint-disable-next-line @zero-admin/design-system/use-new-components -- Tooltip not yet migrated
import { Tooltip } from '@zero-admin/design-system';
import { Badge } from '@wordpress/ui';
import type { DashboardWidgetBadge } from '../../../types';

export type WidgetBadgeProp = string | number | DashboardWidgetBadge | null;

type WidgetBadgeProps = {
	badge?: WidgetBadgeProp;
};

export function WidgetBadge( { badge }: WidgetBadgeProps ) {
	const normalizedBadge = useMemo( () => {
		if ( ! badge ) {
			return null;
		}

		// Normalize badge to object
		if ( typeof badge === 'string' || typeof badge === 'number' ) {
			return {
				value: String( badge ),
				intent: 'informational' as const,
				info: undefined,
			};
		}

		return {
			value: String( badge.value ),
			intent: badge.intent ?? 'informational',
			ariaLabel: badge.ariaLabel,
			info: badge.info,
		};
	}, [ badge ] );

	if ( ! normalizedBadge ) {
		return null;
	}
	const { info, intent, value, ariaLabel } = normalizedBadge;

	if ( info ) {
		return (
			<Tooltip.Root>
				<Tooltip.Trigger render={ <span /> }>
					<Badge intent={ intent } aria-label={ ariaLabel || value }>
						{ value }
					</Badge>
				</Tooltip.Trigger>
				<Tooltip.Popup>{ info }</Tooltip.Popup>
			</Tooltip.Root>
		);
	}

	return (
		<Badge intent={ intent } aria-label={ ariaLabel || value }>
			{ value }
		</Badge>
	);
}
