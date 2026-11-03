import { EmptyState } from '@zero-admin/design-system';
import { __ } from '@wordpress/i18n';
import { useDashboardContext } from '../dashboard/context';
import { emptyDashboardIcon } from './empty-state-icon';

export function DashboardEmpty() {
	const { dashboardWidgets } = useDashboardContext();

	if ( dashboardWidgets.length > 0 ) {
		return null;
	}

	return (
		<EmptyState.Root>
			<EmptyState.Icon icon={ emptyDashboardIcon } />
			<EmptyState.Title>
				{ __( 'All widgets have been removed', 'zero-admin' ) }
			</EmptyState.Title>
			<EmptyState.Description>
				{ __(
					"Add widgets to track your store's performance and activity.",
					'zero-admin'
				) }
			</EmptyState.Description>
		</EmptyState.Root>
	);
}
