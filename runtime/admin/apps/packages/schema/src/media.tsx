import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiFetch from '@wordpress/api-fetch';
import { decodeEntities } from '@wordpress/html-entities';
import { image as imageIcon, pencil, trash } from '@wordpress/icons';
import { useParams, useNavigate, useSearch } from '@wordpress/route';
import {
	Button,
	DropZone,
	FocalPointPicker,
	FormFileUpload,
	Notice,
	TextControl,
	TextareaControl,
} from '@wordpress/components';
import {
	Page,
	RouterLink,
	createConfirmModal,
	useDocumentChanges,
} from '@typedpress-admin/admin-toolkit';
import type { Action, View, Field } from '@typedpress-admin/dataviews';
import { DataViews, useView } from '@typedpress-admin/views';
import { uploadAttachment } from '@typedpress-admin/attachment-importer';
import { allowed, object, text, type Row } from './model';
import { api, bootstrap, message, unwrap, useLoad } from './api';
import { Loading } from './screens';

function thumbnailUrl(item: Row): string | undefined {
	if (text(item.media_type) !== 'image') return undefined;
	const details =
		item.media_details && typeof item.media_details === 'object'
			? object(item.media_details)
			: undefined;
	const sizes =
		details?.sizes && typeof details.sizes === 'object'
			? object(details.sizes)
			: undefined;
	for (const size of ['medium', 'thumbnail', 'medium_large', 'full']) {
		const entry = sizes?.[size];
		if (entry && typeof entry === 'object') {
			const url = text(object(entry).source_url);
			if (url) return url;
		}
	}
	return text(item.source_url);
}

function mediaTitle(item: Row): string {
	const titleObj = item.title && typeof item.title === 'object' ? object(item.title) : {};
	const rendered = text(titleObj.rendered) ?? text(titleObj.raw);
	return rendered ? decodeEntities(rendered) : `#${String(item.id)}`;
}

function formatMediaDate(value: unknown): string {
	if (typeof value !== 'string' || !value) return '—';
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;
	return new Intl.DateTimeFormat(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	}).format(parsed);
}

export function MediaLibrary() {
	const search = object(useSearch({ from: '/media' })),
		navigate = useNavigate();
	const page = Math.max(1, Number(search.page) || 1),
		query = text(search.search) ?? '';
	const defaultView = useMemo<View>(() => ({
		type: 'grid',
		mediaField: 'thumbnail',
		titleField: 'title',
		fields: ['mime_type', 'date'],
		perPage: 24,
		sort: { field: 'date', direction: 'desc' },
	}), []);
	const defaultLayouts = useMemo(() => ({ grid: {}, table: {} }), []);
	const onChangeQueryParams = useCallback((params: { page?: number; search?: string }) => {
		void navigate({
			to: '/media',
			search: { page: params.page, search: params.search || undefined },
		});
	}, [navigate]);
	const { view, updateView, isModified, resetToDefault } = useView({
		kind: 'tpMedia',
		name: 'attachment',
		slug: 'all',
		defaultView,
		defaultLayouts,
		queryParams: { page, search: query },
		onChangeQueryParams,
	});
	const perPage = view.perPage ?? 24;
	const [revision, setRevision] = useState(0),
		[busy, setBusy] = useState(false),
		[error, setError] = useState('');
	const canUpload = allowed('author', bootstrap().role);
	const canEdit = allowed('editor', bootstrap().role);

	const uploadFiles = useCallback((files: File[]) => {
		if (!files.length) return;
		setBusy(true);
		setError('');
		void Promise.allSettled(files.map(uploadAttachment))
			.then((results) => {
				setError(
					results
						.flatMap((result) =>
							result.status === 'rejected' ? [message(result.reason)] : []
						)
						.join(' ')
				);
				setRevision((v) => v + 1);
			})
			.finally(() => setBusy(false));
	}, []);

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

	const deleteModal = useMemo(
		() =>
			createConfirmModal<Row>({
				modalHeader: (items) =>
					items.length === 1 ? 'Delete media file' : `Delete ${items.length} media files`,
				intent: 'delete-permanently',
				message: (items) =>
					items.length === 1
						? `Delete "${mediaTitle(items[0])}" permanently? References to it will be cleared.`
						: `Delete ${items.length} files permanently? References to them will be cleared.`,
				onSubmit: async (items, setIsLoading) => {
					setIsLoading(true);
					setError('');
					try {
						await Promise.all(
							items.map((item) =>
								apiFetch({
									...api(`/media/${encodeURIComponent(String(item.id))}`),
									method: 'DELETE',
								})
							)
						);
						setRevision((v) => v + 1);
					} catch (e: unknown) {
						setError(message(e));
					}
				},
			}),
		[]
	);

	const actions = useMemo<Action<Row>[]>(() => {
		const listActions: Action<Row>[] = [
			{
				id: 'edit-details',
				label: 'Edit details',
				isPrimary: true,
				icon: pencil,
				supportsBulk: false,
				callback: (items) => {
					const item = items[0];
					if (!item) return;
					void navigate({ to: `/media/${encodeURIComponent(String(item.id))}` });
				},
			},
			{
				id: 'edit-image',
				label: 'Edit image',
				isPrimary: false,
				icon: imageIcon,
				supportsBulk: false,
				isEligible: (item) => canEdit && text(item.media_type) === 'image',
				callback: (items) => {
					const item = items[0];
					if (!item) return;
					void navigate({
						to: `/types/attachment/edit/${encodeURIComponent(String(item.id))}`,
					});
				},
			},
		];
		if (canEdit) {
			listActions.push({
				id: 'delete-media',
				label: 'Delete',
				isPrimary: false,
				icon: trash,
				supportsBulk: true,
				...deleteModal,
			});
		}
		return listActions;
	}, [canEdit, navigate, deleteModal]);

	const fields: Field<Row>[] = useMemo(
		() => [
			{
				id: 'thumbnail',
				label: 'Preview',
				enableSorting: false,
				filterBy: false,
				render: ({ item }) => {
					const url = thumbnailUrl(item);
					const title = mediaTitle(item);
					if (url) {
						return (
							<RouterLink
								className="typedpress-schema-media-thumb"
								to={`/media/${String(item.id)}`}
							>
								<img
									src={url}
									alt={text(item.alt_text) || title}
									loading="lazy"
								/>
							</RouterLink>
						);
					}
					const mime = text(item.mime_type) ?? 'file';
					const ext = mime.includes('/') ? mime.split('/')[1].toUpperCase() : mime.toUpperCase();
					return (
						<RouterLink
							className="typedpress-schema-media-thumb is-file"
							to={`/media/${String(item.id)}`}
						>
							<span>{ext}</span>
						</RouterLink>
					);
				},
			},
			{
				id: 'title',
				label: 'Title',
				enableSorting: false,
				filterBy: false,
				render: ({ item }) => (
					<RouterLink
						className="typedpress-schema-title-link"
						to={`/media/${String(item.id)}`}
					>
						{mediaTitle(item)}
					</RouterLink>
				),
			},
			{
				id: 'mime_type',
				label: 'Type',
				enableSorting: false,
				filterBy: false,
				render: ({ item }) => (
					<span className="typedpress-schema-badge is-neutral">
						{text(item.mime_type) ?? '—'}
					</span>
				),
			},
			{
				id: 'date',
				label: 'Uploaded',
				enableSorting: false,
				filterBy: false,
				render: ({ item }) => (
					<span className="typedpress-schema-cell-muted">
						{formatMediaDate(item.date_gmt ?? item.date)}
					</span>
				),
			},
			{
				id: 'alt_text',
				label: 'Alt text',
				enableSorting: false,
				filterBy: false,
				render: ({ item }) => (
					<span className="typedpress-schema-cell-truncate">
						{text(item.alt_text) || '—'}
					</span>
				),
			},
		],
		[]
	);

	return (
		<Page
			title="Media"
			hasPadding={false}
			actions={
				canUpload && (
					<FormFileUpload
						accept="image/*,video/*,audio/*,application/pdf"
						multiple
						onChange={(event) => {
							uploadFiles(Array.from(event.target.files ?? []));
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
			<div className="typedpress-schema-media-surface">
				{canUpload && (
					<DropZone
						label="Drop files to upload"
						onFilesDrop={(files) => uploadFiles(files)}
					/>
				)}
				{error && (
					<Notice status="error" isDismissible onRemove={() => setError('')}>
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
						actions={actions}
						onChangeView={(next) =>
							updateView({
								...next,
								page:
									next.search !== query || next.perPage !== perPage
										? 1
										: next.page,
							})
						}
						onReset={
							isModified
								? () => {
										resetToDefault();
										onChangeQueryParams({ page: 1, search: query });
									}
								: false
						}
						getItemId={(r) => String(r.id)}
						defaultLayouts={defaultLayouts}
						paginationInfo={{
							totalItems: state.value.total,
							totalPages: Math.max(1, Math.ceil(state.value.total / perPage)),
						}}
					/>
				)}
			</div>
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
		const [core, tp] = await Promise.all([
			apiFetch({
				path: `/wp/v2/media/${encodeURIComponent(id)}?context=edit`,
			}).catch(() =>
				apiFetch({
					path: `/wp/v2/media/${encodeURIComponent(id)}?context=view`,
				})
			),
			apiFetch(api(`/media/${encodeURIComponent(id)}`)),
		]);
		return { core: object(core), tp: object(unwrap(tp)) };
	}, [id]);
	return (
		<Page
			title="Media details"
			breadcrumbs={
				<RouterLink className="typedpress-schema-back" to="/media">
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
					tp={state.value.tp}
				/>
			)}
		</Page>
	);
}

function MediaForms({ id, core, tp }: { id: string; core: Row; tp: Row }) {
	const [alt, setAlt] = useState(text(tp.alt) ?? ''),
		[point, setPoint] = useState(focal(tp.focal));
	const [title, setTitle] = useState(
			text(object(core.title).raw) ??
				decodeEntities(text(object(core.title).rendered) ?? '')
		),
		[caption, setCaption] = useState(
			text(object(core.caption).raw) ??
				decodeEntities(text(object(core.caption).rendered) ?? '')
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
		<div className="typedpress-schema-form">
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
					className="typedpress-schema-media-preview"
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
				className="typedpress-schema-caption-form"
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
				<div className="typedpress-schema-caption-form">
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
