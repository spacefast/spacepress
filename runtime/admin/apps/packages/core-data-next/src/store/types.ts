import type {
	Field,
	View,
	SupportedLayouts,
	Form,
	Filter,
} from '@spacepress-admin/dataviews';

export interface FieldDefinition {
	type: string;
	label?: string;
	placeholder?: string;
	enableSorting?: boolean;
	filterBy?: boolean | 'object';
	[ key: string ]: unknown;
}

export interface FieldCollection< T > {
	id: string;
	kind: string;
	name: string;
	fields: Field< T >[];
	fields_module?: string | null;
}

export interface FormSection {
	id: string;
	title: string;
	fields: string[];
}

export interface ViewConfig {
	kind: string;
	name: string | null;
	variant?: string;
	labels?: {
		title?: string;
		description?: string;
		add_button_label?: string;
	};
	default_view?: View;
	default_layouts?: SupportedLayouts;
	quick_edit_form?: Form;
	add_form?: Form;
	edit_form?: Form;
	tabs?: Array< {
		slug: string;
		label: string;
		filters?: Array< Filter >;
		default_view?: View;
	} >;
	actions?: string[];
	allowed_fields?: string[];
}

export interface State {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic variance requires any for covariant field collection usage
	fieldCollections: Record< string, FieldCollection< any >[] >;
	viewConfigs: Record< string, ViewConfig | null >;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-redundant-type-constituents -- untyped editor data from WordPress
	editorSettings: any | null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-redundant-type-constituents -- untyped editor data from WordPress
	editorAssets: any | null;
}
