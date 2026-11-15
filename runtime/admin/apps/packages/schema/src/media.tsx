import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiFetch from '@wordpress/api-fetch';
import { useParams, useNavigate, useSearch } from '@wordpress/route';
import {
	Button,
	FocalPointPicker,
	FormFileUpload,
	Notice,
	TextControl,
	TextareaControl,
} from '@wordpress/components';
import { Page, RouterLink, useDocumentChanges } from '@first-admin/admin-toolkit';
import type { View, Field } from '@first-admin/dataviews';
import { DataViews, useView } from '@first-admin/views';
import { uploadAttachment } from '@first-admin/attachment-importer';
import { allowed, object, text, type Row } from './model';
import { api, bootstrap, message, unwrap, useLoad } from './api';
import { Loading } from './screens';

export function MediaLibrary() {
	const search = object(useSearch({ from: '/media' })),
		navigate = useNavigate();
	const page = Math.max(1, Number(search.page) || 1),
		query = text(search.search) ?? '';
	const defaultView = useMemo<View>(() => ({
		type: 'table',
		titleField: 'title',
		fields: ['mime_type', 'alt_text'],
		perPage: 20,
		sort: { field: 'date', direction: 'desc' },
	}), []);
	const defaultLayouts = useMemo(() => ({ table: {} }), []);
	const onChangeQueryParams = useCallback((params: { page?: number; search?: string }) => {
		void navigate({
			to: '/media',
			search: { page: params.page, search: params.search || undefined },
		});
	}, [navigate]);
	const { view, updateView, isModified, resetToDefault } = useView({
		kind: 'firstMedia',
		name: 'attachment',
		slug: 'all',
		defaultView,
		defaultLayouts,
		queryParams: { page, search: query },
		onChangeQueryParams,
	});
	const perPage = view.perPage ?? 20;
	const [revision, setRevision] = useState(0),
		[busy, setBusy] = useState(false),
		[error, setError] = useState('');
	const state = useLoad(async () => {
		const response: Response = await apiFetch({
			path: `/wp/v2/media?context=view&per_page=${perPage}&page=${page}&search=${encodeURIComponent(query)}`,
			parse: false,
		});
		const data: unknown = await response.json();
		if (!Array.isArray(data)) throw new Error('Expected media results.');
		return {
			rows: data.map((r: unknown) => object(r)),
			total: Number(response.headers.get('X-WP-Total')),
		};
	}, [page, perPage, query, revision]);
	const fields: Field<Row>[] = [
		{
			id: 'title',
			label: 'Title',
			enableSorting: false,
			filterBy: false,
			render: ({ item }) => (
				<RouterLink to={`/media/${String(item.id)}`}>
					{text(object(item.title).rendered) || `#${String(item.id)}`}
				</RouterLink>
			),
		},
		{ id: 'mime_type', label: 'Type', enableSorting: false, filterBy: false },
		{ id: 'alt_text', label: 'Alt text', enableSorting: false, filterBy: false },
	];
	return (
		<Page
			title="Media"
			hasPadding={false}
			actions={
				allowed('author', bootstrap().role) && (
					<FormFileUpload
						accept="image/*,video/*,audio/*,application/pdf"
						multiple
						onChange={(event) => {
							const files = Array.from(event.target.files ?? []);
							setBusy(true);
							setError('');
							Promise.allSettled(files.map(uploadAttachment))
								.then((results) => {
									setError(results.flatMap((result) =>
										result.status === 'rejected' ? [message(result.reason)] : []
									).join(' '));
									setRevision((v) => v + 1);
								})
								.finally(() => setBusy(false));
						}}
						render={({ openFileDialog }) => (
							<Button
								variant="primary"
								disabled={busy}
								isBusy={busy}
								onClick={openFileDialog}
							>
								Add Media File
							</Button>
						)}
					/>
				)
			}
		>
			{error && (
				<Notice status="error" isDismissible={false}>
					{error}
				</Notice>
			)}
			{state.kind !== 'ready' ? (
				<Loading state={state} />
			) : (
				<DataViews<Row>
					data={state.value.rows}
					fields={fields}
					view={view}
					onChangeView={(next) => updateView({
						...next,
						page: next.search !== query || next.perPage !== perPage ? 1 : next.page,
					})}
					onReset={isModified ? () => {
						resetToDefault();
						onChangeQueryParams({ page: 1, search: query });
					} : false}
					getItemId={(r) => String(r.id)}
					defaultLayouts={defaultLayouts}
					paginationInfo={{
						totalItems: state.value.total,
						totalPages: Math.max(1, Math.ceil(state.value.total / perPage)),
					}}
				/>
			)}
		</Page>
	);
}
function focal(value: unknown): { x: number; y: number } {
	if (
		value &&
		typeof value === 'object' &&
		'x' in value &&
		'y' in value &&
		typeof value.x === 'number' &&
		typeof value.y === 'number'
	)
		return { x: value.x, y: value.y };
	return { x: 0.5, y: 0.5 };
}
export function MediaDocument() {
	const { id } = useParams({ from: '/media/$id' });
	const state = useLoad(async () => {
		const [core, first] = await Promise.all([
			apiFetch({
				path: `/wp/v2/media/${encodeURIComponent(id)}?context=edit`,
			}).catch(() =>
				apiFetch({
					path: `/wp/v2/media/${encodeURIComponent(id)}?context=view`,
				})
			),
			apiFetch(api(`/media/${encodeURIComponent(id)}`)),
		]);
		return { core: object(core), first: object(unwrap(first)) };
	}, [id]);
	return (
		<Page
			title="Media details"
			breadcrumbs={
				<RouterLink className="first-schema-back" to="/media">
					Back to Media
				</RouterLink>
			}
			contentWidth="constrained"
		>
			{state.kind !== 'ready' ? (
				<Loading state={state} />
			) : (
				<MediaForms
					key={id}
					id={id}
					core={state.value.core}
					first={state.value.first}
				/>
			)}
		</Page>
	);
}
function MediaForms({ id, core, first }: { id: string; core: Row; first: Row }) {
	const [alt, setAlt] = useState(text(first.alt) ?? ''),
		[point, setPoint] = useState(focal(first.focal));
	const [title, setTitle] = useState(
			text(object(core.title).raw) ?? text(object(core.title).rendered) ?? ''
		),
		[caption, setCaption] = useState(
			text(object(core.caption).raw) ??
				text(object(core.caption).rendered) ??
				''
		);
	const [busy, setBusy] = useState(false),
		[error, setError] = useState(''),
		[saved, setSaved] = useState('');
	const [confirming, setConfirming] = useState(false),
		navigate = useNavigate();
	const canCaption = 'raw' in object(core.title);
	const canUpdate = allowed('editor', bootstrap().role);
	const [mediaBaseline, setMediaBaseline] = useState({ alt, point });
	const [captionBaseline, setCaptionBaseline] = useState({ title, caption });
	const [deleted, setDeleted] = useState(false);
	const saving = useRef(false), deletionNavigation = useRef(false);
	const mediaDirty = canUpdate && (alt !== mediaBaseline.alt ||
		point.x !== mediaBaseline.point.x || point.y !== mediaBaseline.point.y);
	const captionDirty = canCaption && (title !== captionBaseline.title || caption !== captionBaseline.caption);
	const mutate = useCallback(async (task: () => Promise<unknown>, success: string) => {
		if (saving.current) throw new Error('A save is already in progress.');
		saving.current = true;
		setBusy(true);
		setError('');
		setSaved('');
		try {
			await task();
			setSaved(success);
		} catch (e: unknown) {
			setError(message(e));
			throw e;
		} finally {
			saving.current = false;
			setBusy(false);
		}
	}, []);
	const saveMedia = useCallback(async () => {
		if (!canUpdate) throw new Error('Media cannot be edited.');
		const snapshot = { alt, point };
		await apiFetch({
			...api(`/media/${encodeURIComponent(id)}`),
			method: 'PATCH', data: { alt: snapshot.alt, focal: snapshot.point },
		});
		setMediaBaseline(snapshot);
	}, [canUpdate, id, alt, point]);
	const saveCaption = useCallback(async () => {
		if (!canCaption) throw new Error('Caption and title cannot be edited.');
		const snapshot = { title, caption };
		await apiFetch({
			path: `/wp/v2/media/${encodeURIComponent(id)}`,
			method: 'POST', data: snapshot,
		});
		setCaptionBaseline(snapshot);
	}, [canCaption, id, title, caption]);
	const saveChanges = useCallback(() => mutate(async () => {
		if (mediaDirty) await saveMedia();
		if (captionDirty) await saveCaption();
	}, 'Media saved.'), [mutate, mediaDirty, captionDirty, saveMedia, saveCaption]);
	const sharedChanges = useDocumentChanges({
		dirty: !deleted && (mediaDirty || captionDirty), valid: true,
		saving: busy, save: saveChanges,
	});
	// Successful deletion retires drafts before the shared blocker sees navigation.
	useEffect(() => {
		if (!deleted || !sharedChanges || sharedChanges.dirty || sharedChanges.saving || deletionNavigation.current) return;
		deletionNavigation.current = true;
		void navigate({ to: '/media' }).catch((e: unknown) => setError(message(e)));
	}, [deleted, sharedChanges, navigate]);
	return (
		<div className="first-schema-form">
			{error && (
				<Notice status="error" isDismissible={false}>
					{error}
				</Notice>
			)}
			{saved && (
				<Notice status="success" isDismissible={false}>
					{saved}
				</Notice>
			)}
			{text(core.media_type) === 'image' && (
				<img
					className="first-schema-media-preview"
					src={text(core.source_url)}
					alt={alt}
				/>
			)}
			{canCaption && text(core.media_type) === 'image' && (
                <RouterLink to={`/types/attachment/edit/${encodeURIComponent(id)}`}>
                    Edit image
                </RouterLink>
            )}
            <form
                onSubmit={(e) => {
					e.preventDefault();
					void mutate(saveMedia, 'Media saved.').catch(() => undefined);
				}}
			>
				<TextControl
					label="Alt text"
					value={alt}
					onChange={setAlt}
					disabled={!canUpdate || busy || deleted}
				/>
				{canUpdate && text(core.media_type) === 'image' && (
					<FocalPointPicker
						label="Focal point"
						url={text(core.source_url) ?? ''}
						value={point}
						onChange={setPoint}
					/>
				)}
				<Button type="submit" variant="primary" disabled={!canUpdate || busy || deleted}>
					Save media
				</Button>
			</form>
			<form
				className="first-schema-caption-form"
				onSubmit={(e) => {
					e.preventDefault();
					void mutate(saveCaption, 'Caption and title saved.').catch(() => undefined);
				}}
			>
				<h2>Caption and title</h2>
				<p>These fields use WordPress permissions.</p>
				<TextControl
					label="Title"
					value={title}
					onChange={setTitle}
					disabled={!canCaption || busy || deleted}
				/>
				<TextareaControl
					label="Caption"
					value={caption}
					onChange={setCaption}
					disabled={!canCaption || busy || deleted}
				/>
				<Button
					type="submit"
					variant="secondary"
					disabled={!canCaption || busy || deleted}
				>
					Save caption and title
				</Button>
			</form>
			{canUpdate && (
				<div className="first-schema-caption-form">
					{confirming ? (
						<>
							<p>
								Delete this file permanently? References to it will be cleared.
							</p>
							<Button
								variant="primary"
								isDestructive
								disabled={busy}
								onClick={() => {
									void mutate(async () => {
										await apiFetch({
											...api(`/media/${encodeURIComponent(id)}`),
											method: 'DELETE',
										});
										setDeleted(true);
									}, 'Deleted.').catch(() => undefined);
								}}
							>
								Confirm delete
							</Button>
							<Button variant="tertiary" onClick={() => setConfirming(false)}>
								Cancel
							</Button>
						</>
					) : (
						<Button
							variant="tertiary"
							isDestructive
							onClick={() => setConfirming(true)}
						>
							Delete media
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
