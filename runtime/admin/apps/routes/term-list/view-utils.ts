import type { ViewConfig } from '@first-admin/core-data-next';
import type { Taxonomy } from '@wordpress/core-data';
import type { View } from '@first-admin/dataviews';

const DEFAULT_VIEW: View = {
	type: 'table',
	layout: {} as const,
	sort: {
		field: 'slug',
		direction: 'asc',
	},
	filters: [],
	fields: [ 'slug', 'count' ],
	titleField: 'name',
	descriptionField: 'description',
};

function cloneView( view: View ): View {
	const filters = view.filters
		? view.filters.map( ( filter ) => ( { ...filter } ) )
		: view.filters;
	const fields = view.fields ? [ ...view.fields ] : view.fields;

	if ( view.type === 'table' ) {
		return {
			...view,
			layout: view.layout ? { ...view.layout } : view.layout,
			filters,
			fields,
		};
	}

	if ( view.type === 'grid' || view.type === 'pickerGrid' ) {
		return {
			...view,
			layout: view.layout ? { ...view.layout } : view.layout,
			filters,
			fields,
		};
	}

	return {
		...view,
		filters,
		fields,
	};
}

export function getDefaultView(
	taxonomy: Taxonomy | undefined,
	viewConfig?: ViewConfig | null
) {
	const baseViewSource =
		viewConfig?.default_view !== undefined &&
		viewConfig?.default_view !== null
			? viewConfig.default_view
			: DEFAULT_VIEW;

	const baseView = cloneView( baseViewSource );

	return {
		...baseView,
		showLevels:
			baseView.showLevels !== undefined
				? baseView.showLevels
				: !! taxonomy?.hierarchical,
	} as View;
}

export function viewToQuery( view: View ) {
	const result: Record< string, unknown > = {};

	if ( undefined !== view.perPage ) {
		result.per_page = view.perPage;
	}

	if ( undefined !== view.page ) {
		result.page = view.page;
	}

	if ( ! [ undefined, '' ].includes( view.search ) ) {
		result.search = view.search;
	}

	if ( undefined !== view.sort?.field ) {
		result.orderby = view.sort.field;
	}

	if ( undefined !== view.sort?.direction ) {
		result.order = view.sort.direction;
	}

	if ( view.showLevels ) {
		result.orderby_hierarchy = true;
	}

	if ( view.filters && view.filters.length > 0 ) {
		view.filters.forEach( ( filter ) => {
			if ( filter.field === 'count' && filter.operator === 'is' ) {
				result.hide_empty = filter.value === 'hide_empty';
			}
		} );
	}

	return result;
}
