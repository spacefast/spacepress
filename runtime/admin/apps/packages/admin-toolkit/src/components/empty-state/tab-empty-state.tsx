import { useState } from 'react';
import { __ } from '@wordpress/i18n';
import type { View } from '@zero-admin/dataviews';
import { Spinner } from '@wordpress/components';
import { Button, Icon } from '@wordpress/ui';
import { chevronRight } from '@wordpress/icons';
import { EmptyState } from '@zero-admin/design-system';
import './style.scss';

export interface EmptyStateAction {
	label: string;
	description?: string;
	icon?: React.JSX.Element | null;
	onClick: () => void;
	isCreating: boolean;
}

export interface TabEmptyStateProps< TView extends View = View > {
	view?: TView;
	isFiltered?: boolean;
	onClearFilters?: () => void;
	icon: React.ReactNode;
	title: string;
	description: string | React.ReactNode;
	filteredTitle?: string;
	filteredDescription?: string | React.ReactNode;
	filteredButtonLabel?: string;
	actions?: EmptyStateAction[];
}

const DEFAULT_FILTERED_TITLE = __(
	'No items match your filters',
	'zero-admin'
);

const DEFAULT_FILTERED_DESCRIPTION = __(
	'Try clearing some filters or adjusting your search query.',
	'zero-admin'
);

export function TabEmptyState< TView extends View = View >( {
	view,
	isFiltered: isFilteredProp,
	onClearFilters,
	icon,
	title,
	description,
	filteredTitle = DEFAULT_FILTERED_TITLE,
	filteredDescription = DEFAULT_FILTERED_DESCRIPTION,
	filteredButtonLabel,
	actions,
}: TabEmptyStateProps< TView > ) {
	const isCreatingAny = actions?.some( ( action ) => action.isCreating );
	const [ clicked, setClicked ] = useState( false );
	const isLoading =
		clicked || ( actions?.length === 1 && actions[ 0 ].isCreating );

	// Calculate isFiltered from view if provided, otherwise use the prop
	let isFiltered = isFilteredProp;
	if ( isFiltered === undefined && view ) {
		const hasNonLockedFilters =
			view.filters?.some( ( filter ) => ! filter.isLocked ) ?? false;
		const hasSearch = ( view.search ?? '' ).length > 0;
		isFiltered = hasNonLockedFilters || hasSearch;
	}
	isFiltered = isFiltered ?? false;

	if ( isFiltered ) {
		return (
			<EmptyState.Root>
				<EmptyState.Visual>{ icon }</EmptyState.Visual>
				<EmptyState.Title>{ filteredTitle }</EmptyState.Title>
				<EmptyState.Description>
					{ filteredDescription }
				</EmptyState.Description>
				{ onClearFilters && (
					<EmptyState.Actions>
						<Button variant="outline" onClick={ onClearFilters }>
							{ filteredButtonLabel ??
								__( 'Clear filters', 'zero-admin' ) }
						</Button>
					</EmptyState.Actions>
				) }
			</EmptyState.Root>
		);
	}

	return (
		<EmptyState.Root>
			<EmptyState.Visual>{ icon }</EmptyState.Visual>
			<EmptyState.Title>{ title }</EmptyState.Title>
			<EmptyState.Description>{ description }</EmptyState.Description>
			{ actions?.length === 1 && (
				<EmptyState.Actions>
					{ isLoading ? (
						<Button
							variant="outline"
							disabled
							loading={ true }
							loadingAnnouncement={ __(
								'Loading…',
								'zero-admin'
							) }
						>
							{ actions[ 0 ].label }
						</Button>
					) : (
						<Button
							variant="outline"
							onClick={ () => {
								setClicked( true );
								actions[ 0 ].onClick();
							} }
						>
							{ actions[ 0 ].label }
						</Button>
					) }
				</EmptyState.Actions>
			) }
			{ ( actions?.length ?? 0 ) > 1 && (
				<div className="empty-state-action-cards">
					{ actions?.map( ( action ) => (
						<button
							className="empty-state-action-cards__card"
							onClick={ action.onClick }
							disabled={ isCreatingAny }
							key={ action.label }
						>
							{ action.icon && (
								<span className="empty-state-action-cards__card-icon">
									{ action.icon }
								</span>
							) }
							<span className="empty-state-action-cards__card-content">
								<span className="empty-state-action-cards__card-title">
									{ action.label }
								</span>
								{ action.description && (
									<span className="empty-state-action-cards__card-description">
										{ action.description }
									</span>
								) }
							</span>
							<span className="empty-state-action-cards__card-arrow">
								{ action.isCreating ? (
									<Spinner />
								) : (
									<Icon icon={ chevronRight } size={ 24 } />
								) }
							</span>
						</button>
					) ) }
				</div>
			) }
		</EmptyState.Root>
	);
}
