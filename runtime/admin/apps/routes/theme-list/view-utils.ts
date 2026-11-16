import type { View } from '@typedpress-admin/dataviews';

const DEFAULT_VIEW: View = {
	type: 'grid',
	sort: {
		field: 'active',
		direction: 'desc',
	},
	titleField: 'name',
	mediaField: 'screenshot',
	descriptionField: 'description',
	showDescription: false,
	perPage: 20,
};

export function getDefaultView() {
	return DEFAULT_VIEW;
}
