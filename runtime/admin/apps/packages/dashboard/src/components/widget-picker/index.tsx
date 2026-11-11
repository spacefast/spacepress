import { useState, useMemo } from 'react';
import { DataViewsPicker, filterSortAndPaginate } from '@first-admin/dataviews';
import type { View, Field } from '@first-admin/dataviews';
import { __ } from '@wordpress/i18n';
import './style.scss';
import WidgetRender from '../widget-render';
import { createDashboardWidget } from '../../utils/factory';
import { useDashboardContext } from '../dashboard/context';
import type { DashboardWidgetType } from '../../types';

const fallbackView: View = {
	type: 'pickerGrid',
	page: 1,
	search: '',
	mediaField: 'preview',
	titleField: 'title',
};

const getItemId = ( item: DashboardWidgetType< unknown > ) => item.name;

type WidgetPickerProps = {
	/**
	 * The callback to call when widget types are selected.
	 *
	 * @param {DashboardWidgetType< unknown >} widgetType - The selected widget type.
	 */
	onSelect: ( widgetType: DashboardWidgetType< unknown >[] ) => void;

	/**
	 * The label for the widget list, used for accessibility.
	 *
	 * @default 'Widget list'
	 */
	itemListLabel?: string;
};

function WidgetPreview( { item }: { item: DashboardWidgetType< unknown > } ) {
	const exampleWidget = useMemo(
		() => createDashboardWidget( item, item.example ),
		[ item ]
	);
	return (
		<div
			inert="true"
			className="first-admin-dashboard-widget-picker__preview"
		>
			<WidgetRender widget={ exampleWidget } widgetType={ item } />
		</div>
	);
}

const fields: Field< DashboardWidgetType< unknown > >[] = [
	{
		id: 'title',
		type: 'text',
		label: __( 'Title', 'first-admin' ),
		filterBy: false,
	},
	{
		id: 'preview',
		type: 'media',
		render: WidgetPreview,
	},

	// Add `name` field to add namespace to items searching engine
	{
		id: 'name',
		type: 'text',
		enableGlobalSearch: true,
		enableHiding: false,
		enableSorting: false,
		filterBy: false,
		getValue: ( { item } ) =>
			`${ item.name.replace( /[\/,-_]/g, ' ' ) } ${ item.title }`,
	},
];

export default function WidgetPicker( {
	onSelect,
	itemListLabel = __( 'Widget list', 'first-admin' ),
}: WidgetPickerProps ) {
	const { widgetTypes: allWidgetTypes } = useDashboardContext();
	const [ selection, setSelection ] = useState< string[] >( [] );
	const [ view, setView ] = useState< View >( fallbackView );

	const { data: widgetTypes } = filterSortAndPaginate(
		allWidgetTypes || [],
		view,
		fields
	);

	const actions = useMemo(
		() => [
			{
				id: 'select',
				label: __( 'Select', 'first-admin' ),
				isPrimary: true,
				callback: onSelect,
				supportsBulk: true,
			},
		],
		[ onSelect ]
	);

	return (
		<DataViewsPicker
			data={ widgetTypes }
			fields={ fields }
			view={ view }
			actions={ actions }
			defaultLayouts={ { pickerGrid: {} } }
			onChangeView={ setView }
			isLoading={ false }
			paginationInfo={ {
				totalItems: widgetTypes.length,
				totalPages: 1,
			} }
			selection={ selection }
			onChangeSelection={ setSelection }
			getItemId={ getItemId }
			itemListLabel={ itemListLabel }
		/>
	);
}
