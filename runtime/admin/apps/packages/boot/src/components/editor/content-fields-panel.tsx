import { registerPlugin } from '@wordpress/plugins';
import { PluginDocumentSettingPanel } from '@wordpress/editor';
import { useParams } from '@wordpress/route';
import CollectionDocument from '../../../../../routes/collection-edit/stage';

function ContentFieldsPanel() {
	const params = useParams({
		from: '/collections/$collection/$id',
		shouldThrow: false,
	});
	if (!params?.collection || !params.id) return null;
	return (
		<PluginDocumentSettingPanel
			name="zero-admin-content-fields"
			title="Document details"
		>
			<CollectionDocument embedded />
		</PluginDocumentSettingPanel>
	);
}

registerPlugin('zero-admin-content-fields', { render: ContentFieldsPanel });
