import { useState } from 'react';
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
import { Page, RouterLink } from '@zero-admin/admin-toolkit';
import { DataViews, type View, type Field } from '@zero-admin/dataviews';
import { uploadAttachment } from '@zero-admin/attachment-importer';
import { allowed, object, text, type Row } from './model';
import { bootstrap, message, unwrap, useLoad } from './api';
import { Loading } from './screens';

export function MediaLibrary() {
	const search = object(useSearch({ from: '/media' })),
		navigate = useNavigate();
	const page = Math.max(1, Number(search.page) || 1),
		query = text(search.search) ?? '';
	const [revision, setRevision] = useState(0),
		[busy, setBusy] = useState(false),
		[error, setError] = useState('');
	const state = useLoad(async () => {
		const response: Response = await apiFetch({
			path: `/wp/v2/media?context=view&per_page=20&page=${page}&search=${encodeURIComponent(query)}`,
			parse: false,
		});
		const data: unknown = await response.json();
		if (!Array.isArray(data)) throw new Error('Expected media results.');
		return {
			rows: data.map((r: unknown) => object(r)),
			total: Number(response.headers.get('X-WP-Total')),
		};
	}, [page, query, revision]);
	const fields: Field<Row>[] = [
		{
			id: 'title',
			label: 'Title',
			enableSorting: false,
			render: ({ item }) => (
				<RouterLink to={`/media/${String(item.id)}`}>
					{text(object(item.title).rendered) || `#${String(item.id)}`}
				</RouterLink>
			),
		},
		{ id: 'mime_type', label: 'Type', enableSorting: false },
		{ id: 'alt_text', label: 'Alt text', enableSorting: false },
	];
	const view: View = {
		type: 'table',
		titleField: 'title',
		fields: ['mime_type', 'alt_text'],
		page,
		perPage: 20,
		search: query,
	};
	return (
		<Page
			title="Media"
			actions={
				allowed('author', bootstrap().role) && (
					<FormFileUpload
						accept="image/*,video/*,audio/*,application/pdf"
						multiple
						onChange={(event) => {
							const files = Array.from(event.target.files ?? []);
							setBusy(true);
							setError('');
							Promise.all(files.map(uploadAttachment))
								.then(
									() => setRevision((v) => v + 1),
									(e: unknown) => setError(message(e))
								)
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
					onChangeView={(v) => {
						void navigate({
							to: '/media',
							search: {
								page: v.search !== query ? 1 : v.page,
								search: v.search || undefined,
							},
						});
					}}
					getItemId={(r) => String(r.id)}
					defaultLayouts={{ table: {} }}
					paginationInfo={{
						totalItems: state.value.total,
						totalPages: Math.max(1, Math.ceil(state.value.total / 20)),
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
		const [core, zero] = await Promise.all([
			apiFetch({
				path: `/wp/v2/media/${encodeURIComponent(id)}?context=edit`,
			}).catch(() =>
				apiFetch({
					path: `/wp/v2/media/${encodeURIComponent(id)}?context=view`,
				})
			),
			apiFetch({ path: `/zero/v1/media/${encodeURIComponent(id)}` }),
		]);
		return { core: object(core), zero: object(unwrap(zero)) };
	}, [id]);
	return (
		<Page
			title="Media details"
			breadcrumbs={
				<RouterLink className="zero-schema-back" to="/media">
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
					zero={state.value.zero}
				/>
			)}
		</Page>
	);
}
function MediaForms({ id, core, zero }: { id: string; core: Row; zero: Row }) {
	const [alt, setAlt] = useState(text(zero.alt) ?? ''),
		[point, setPoint] = useState(focal(zero.focal));
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
	async function mutate(task: () => Promise<unknown>, success: string) {
		setBusy(true);
		setError('');
		setSaved('');
		try {
			await task();
			setSaved(success);
		} catch (e: unknown) {
			setError(message(e));
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className="zero-schema-form">
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
					className="zero-schema-media-preview"
					src={text(core.source_url)}
					alt={alt}
				/>
			)}
			<form
				onSubmit={(e) => {
					e.preventDefault();
					void mutate(
						() =>
							apiFetch({
								path: `/zero/v1/media/${encodeURIComponent(id)}`,
								method: 'PATCH',
								data: { alt, focal: point },
							}),
						'Media saved.'
					);
				}}
			>
				<TextControl
					label="Alt text"
					value={alt}
					onChange={setAlt}
					disabled={!canUpdate || busy}
				/>
				{canUpdate && text(core.media_type) === 'image' && (
					<FocalPointPicker
						label="Focal point"
						url={text(core.source_url) ?? ''}
						value={point}
						onChange={setPoint}
					/>
				)}
				<Button type="submit" variant="primary" disabled={!canUpdate || busy}>
					Save media
				</Button>
			</form>
			<form
				className="zero-schema-caption-form"
				onSubmit={(e) => {
					e.preventDefault();
					void mutate(
						() =>
							apiFetch({
								path: `/wp/v2/media/${encodeURIComponent(id)}`,
								method: 'POST',
								data: { title, caption },
							}),
						'Caption and title saved.'
					);
				}}
			>
				<h2>Caption and title</h2>
				<p>These fields use WordPress permissions.</p>
				<TextControl
					label="Title"
					value={title}
					onChange={setTitle}
					disabled={!canCaption || busy}
				/>
				<TextareaControl
					label="Caption"
					value={caption}
					onChange={setCaption}
					disabled={!canCaption || busy}
				/>
				<Button
					type="submit"
					variant="secondary"
					disabled={!canCaption || busy}
				>
					Save caption and title
				</Button>
			</form>
			{canUpdate && (
				<div className="zero-schema-caption-form">
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
											path: `/zero/v1/media/${encodeURIComponent(id)}`,
											method: 'DELETE',
										});
										await navigate({ to: '/media' });
									}, 'Deleted.');
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
