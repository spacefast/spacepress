import type { View } from '@first-admin/dataviews';
import { TabEmptyState, type TabEmptyStateProps } from './tab-empty-state';
import './style.scss';

export function ScreenEmptyState< TView extends View = View >(
	props: Omit<
		TabEmptyStateProps< TView >,
		| 'isFiltered'
		| 'filteredTitle'
		| 'filteredDescription'
		| 'onClearFilters'
		| 'view'
	>
) {
	return (
		<div className="woocommerce-screen-empty-state">
			<TabEmptyState { ...props } />
		</div>
	);
}
