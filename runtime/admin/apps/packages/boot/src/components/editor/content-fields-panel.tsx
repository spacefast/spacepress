import { useState } from 'react';
import { registerPlugin } from '@wordpress/plugins';
import { PluginDocumentSettingPanel, store as editorStore } from '@wordpress/editor';
import { useParams } from '@wordpress/route';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import {
	EditingObjects,
	Fields,
	Loading,
	collectionSpec,
	fromNative,
	native,
	toNative,
	useLoad,
	object,
	map,
} from '@zero-admin/schema';

function ContentFieldsPanel() {
	const params = useParams({
		from: '/collections/$collection/$slug',
		shouldThrow: false,
	});
	const { postId, postType } = useSelect((select) => ({
		postId: select(editorStore).getCurrentPostId(),
		postType: select(editorStore).getCurrentPostType(),
	}), []);
	if (!params?.collection || !params.slug) return null;
	// PluginArea also renders before the native editor mounts. Resolving its record
	// then would cache empty blocks before the editor's block types are registered.
	if (String(postId) !== params.slug || postType !== native(params.collection)?.postType)
		return null;
	return <DocumentFields collection={params.collection} id={params.slug} />;
}
function DocumentFields({
	collection,
	id,
}: {
	collection: string;
	id: string;
}) {
	const [objects] = useState(() => new EditingObjects());
	const state = useLoad(() => collectionSpec(collection), [collection]);
	const transport = native(collection);
	const record = useSelect(
		(select) => {
			if (!transport) return undefined;
			const base = select(coreStore).getEntityRecord(
				'postType',
				transport.postType,
				id
			);
			const edited = select(coreStore).getEditedEntityRecord(
				'postType',
				transport.postType,
				id
			);
			if (!base || !edited) return undefined;
			return {
				...edited,
				acf: {
					...map(object(base).acf ?? {}),
					...map(object(edited).acf ?? {}),
				},
			};
		},
		[collection, id]
	);
	const pending = useSelect(
		(select) =>
			transport
				? select(coreStore).getEntityRecordEdits(
						'postType',
						transport.postType,
						id
					)
				: undefined,
		[collection, id]
	);
	const { editEntityRecord } = useDispatch(coreStore);
	if (!transport || !record) return null;
	return (
		<PluginDocumentSettingPanel name="zero-admin-content-fields" title="Fields">
			{state.kind !== 'ready' ? (
				<Loading state={state} />
			) : (
				<Fields
					fields={state.value.columns}
					values={fromNative(state.value, record, objects)}
					objects={objects}
					omit={[
						state.value.primaryKey,
						state.value.title ?? '',
						state.value.content ?? '',
						state.value.slug ?? '',
						'status',
						'publishedAt',
					]}
					onChange={(key, value) => {
						const edits = toNative(state.value, { [key]: value }, objects);
						void editEntityRecord('postType', transport.postType, id, {
							acf: {
								...object(object(pending ?? {}).acf ?? {}),
								...object(edits.acf ?? {}),
							},
						});
					}}
				/>
			)}
		</PluginDocumentSettingPanel>
	);
}
registerPlugin('zero-admin-content-fields', { render: ContentFieldsPanel });
