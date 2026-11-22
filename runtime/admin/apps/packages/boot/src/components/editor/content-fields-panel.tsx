import { useEffect, useState } from 'react';
import { useEntityValidity } from '@typedpress-admin/admin-toolkit';
import { registerPlugin } from '@wordpress/plugins';
import { PluginDocumentSettingPanel, store as editorStore } from '@wordpress/editor';
import { useParams } from '@wordpress/route';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import {
	EditingObjects,
	Fields,
	useFieldDrafts,
	Loading,
	collectionSpec,
	fromNative,
	native,
	toNative,
	useLoad,
	object,
	map,
} from '@typedpress-admin/schema';

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
	return <DocumentFields key={`${params.collection}/${params.slug}`} collection={params.collection} id={params.slug} />;
}
function DocumentFields({
	collection,
	id,
}: {
	collection: string;
	id: string;
}) {
	const [objects] = useState(() => new EditingObjects());
	const { setIsEntityValid } = useEntityValidity();
	const { lockPostSaving, unlockPostSaving, lockPostAutosaving, unlockPostAutosaving } = useDispatch(editorStore);
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
				meta: {
					...map(object(base).meta ?? {}),
					...map(object(edited).meta ?? {}),
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
	const values = state.kind === 'ready' && record ? fromNative(state.value, record) : undefined;
	const omit = state.kind === 'ready' ? [state.value.primaryKey, state.value.title ?? '', state.value.content ?? '', state.value.slug ?? '', 'status', 'publishedAt'] : [];
	const jsonDrafts = useFieldDrafts(state.kind === 'ready' && values ? { fields: state.value.columns, values, objects, omit } : undefined);
	const valid = jsonDrafts.valid;
	useEffect(() => {
		const lock = `typedpress-fields:${collection}/${id}`;
		setIsEntityValid(valid);
		if (!valid) {
			void lockPostSaving(lock);
			void lockPostAutosaving(lock);
		}
		return () => {
			void unlockPostSaving(lock);
			void unlockPostAutosaving(lock);
			setIsEntityValid(true);
		};
	}, [valid, collection, id, setIsEntityValid, lockPostSaving, unlockPostSaving, lockPostAutosaving, unlockPostAutosaving]);
	if (!transport || !record) return null;
	return (
		<PluginDocumentSettingPanel name="typedpress-admin-content-fields" title="Fields">
			{state.kind !== 'ready' ? (
				<Loading state={state} />
			) : (
				<Fields
					fields={state.value.columns}
					values={values ?? {}}
					objects={objects}
					jsonDrafts={jsonDrafts}
					omit={omit}
					onChange={(key, value) => {
						const edits = toNative(state.value, { [key]: value });
					void editEntityRecord('postType', transport.postType, id, {
						...edits,
						...(edits.meta ? { meta: {
							...map(object(pending ?? {}).meta ?? {}),
							...object(edits.meta ?? {}),
						} } : {}),
						});
					}}
				/>
			)}
		</PluginDocumentSettingPanel>
	);
}
registerPlugin('typedpress-admin-content-fields', { render: ContentFieldsPanel });
