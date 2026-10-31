import { store as coreDataNextStore } from '@zero-admin/core-data-next';
import { useSelect } from '@wordpress/data';

/**
 * Hook to get ViewConfig and its labels
 *
 * @param kind    - The entity kind
 * @param name    - The entity name
 * @param variant - Optional. View config identifier
 * @return ViewConfig and helper methods
 */
export function useViewConfig( kind: string, name: string, variant?: string ) {
	const viewConfig = useSelect(
		( select ) => {
			const { getEntityViewConfig } = select( coreDataNextStore );
			return getEntityViewConfig( kind, name, variant );
		},
		[ kind, name, variant ]
	);

	return {
		viewConfig,
		labels: viewConfig?.labels || {},
		actions: viewConfig?.actions || [],
		tabs: viewConfig?.tabs || [],
		defaultView: viewConfig?.default_view,
		defaultLayouts: viewConfig?.default_layouts,
		quickEditForm: viewConfig?.quick_edit_form,
		addForm: viewConfig?.add_form,
		editForm: viewConfig?.edit_form,
		allowedFields: viewConfig?.allowed_fields,
	};
}
