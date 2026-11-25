import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiFetch from '@wordpress/api-fetch';
import { decodeEntities } from '@wordpress/html-entities';
import { external, pencil, trash } from '@wordpress/icons';
import { useNavigate, useParams, useSearch } from '@wordpress/route';
import { Button, Notice, Spinner } from '@wordpress/components';
import {
	Page,
	RouterLink,
	createConfirmModal,
	useDocumentChanges,
} from '@spacepress-admin/admin-toolkit';
import type { Action, Field, View } from '@spacepress-admin/dataviews';
import { DataViews, useView } from '@spacepress-admin/views';
import {
	EditingObjects,
	allowed,
	defaultListColumns,
	defaults,
	label as humanLabel,
	object,
	singularLabel,
	stripHtml,
	text,
	type Row,
	type Collection,
	type Column,
	type Columns,
} from './model';
import {
	api,
	bootstrap,
	collectionSpec,
	list,
	message,
	native,
	nativeEditor,
	read,
	remove,
	save,
	schema,
	unwrap,
	useLoad,
	type Load,
} from './api';
import { Fields, useFieldDrafts } from './fields';
import './style.scss';

export function Loading({ state }: { state: Load<unknown> }) {
	return state.kind === 'error' ? (
		<div role="alert">
			<Notice status="error" isDismissible={false}>
				{state.message}
			</Notice>
		</div>
	) : (
		<div role="status" className="spacepress-schema-loading">
			<Spinner />
			<span>Loading…</span>
		</div>
	);
}

export function Overview() {
	const state = useLoad(schema, []);
	return (
		<Page title="Collections" subTitle="Your app’s content and data.">
			{state.kind !== 'ready' ? (
				<Loading state={state} />
			) : (
				<div className="spacepress-schema-cards">
					{Object.values(state.value.collections)
						.filter((c) => bootstrap().readable.includes(c.name))
						.map((c) => (
							<article key={c.name}>
								<h2>
									<RouterLink to={`/collections/${c.name}`}>
										{c.label}
									</RouterLink>
								</h2>
								{c.ui?.description && <p>{c.ui.description}</p>}
								<p className="spacepress-schema-card-meta">
									{Object.keys(c.columns).length} fields
								</p>
							</article>
						))}
				</div>
			)}
		</Page>
	);
}

function formatDate(value: unknown): string {
	if (typeof value !== 'string' || !value) return '—';
	const normalized = value.includes('T') && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)
		? `${value}Z`
		: value;
	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.getTime())) return value;
	return new Intl.DateTimeFormat(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	}).format(parsed);
}

function statusTone(status: string): string {
	switch (status.toLowerCase()) {
		case 'published':
		case 'publish':
		case 'active':
		case 'completed':
		case 'paid':
			return 'success';
		case 'scheduled':
		case 'future':
		case 'processing':
			return 'info';
		case 'pending':
		case 'review':
		case 'paused':
			return 'warning';
		case 'trash':
		case 'failed':
		case 'cancelled':
		case 'canceled':
		case 'rejected':
			return 'error';
		default:
			return 'neutral';
	}
}

function formatCellText(value: unknown, col?: Column): string {
	if (value == null || value === '') return '—';
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	if (Array.isArray(value)) {
		return value.length === 0
			? '—'
			: value.length === 1
				? '1 item'
				: `${value.length} items`;
	}
	if (typeof value === 'object') {
		const keys = Object.keys(value);
		return keys.length ? `${keys.length} fields` : '—';
	}
	const raw = String(value);
	if (col && (col.type === 'date' || col.type === 'timestamp' || col.type === 'datetime')) {
		return formatDate(raw);
	}
	if (col && (col.type === 'richText' || col.multiline) || /<[a-z][\s\S]*>/i.test(raw)) {
		const plain = decodeEntities(stripHtml(raw));
		return plain.length > 90 ? `${plain.slice(0, 89)}…` : plain || '—';
	}
	const decoded = decodeEntities(raw);
	return decoded.length > 90 ? `${decoded.slice(0, 89)}…` : decoded;
}

function renderCell(value: unknown, key: string, col: Column) {
	if (value == null || value === '') {
		return <span className="spacepress-schema-cell-muted">—</span>;
	}
	if (key === 'status' || (col.options.length > 0 && typeof value === 'string')) {
		const str = String(value);
		const tone = key === 'status' ? statusTone(str) : 'neutral';
		return (
			<span className={`spacepress-schema-badge is-${tone}`}>
				{humanLabel(str)}
			</span>
		);
	}
	if (col.type === 'boolean' && typeof value === 'boolean') {
		return (
			<span className={`spacepress-schema-badge is-${value ? 'success' : 'neutral'}`}>
				{value ? 'Yes' : 'No'}
			</span>
		);
	}
	if (key === 'slug' || col.type === 'url') {
		return (
			<code className="spacepress-schema-cell-code">
				{formatCellText(value, col)}
			</code>
		);
	}
	return (
		<span className="spacepress-schema-cell-truncate">
			{formatCellText(value, col)}
		</span>
	);
}

export function listFields(c: Collection, rows: Row[]): Field<Row>[] {
	const linkField =
		c.title && rows.some((r) => c.title && c.title in r)
			? c.title
			: c.primaryKey;
	const fields: Field<Row>[] = Object.entries(c.columns)
		.filter(([key]) => key === c.primaryKey || key === c.title || rows.some((r) => key in r))
		.map(([key, col]) => ({
			id: key,
			label: col.label,
			description: col.help,
			type:
				col.type === 'integer'
					? 'integer'
					: col.type === 'boolean'
						? 'boolean'
						: 'text',
			enableSorting: key === c.primaryKey || key === c.title,
			enableGlobalSearch: key === c.title,
			filterBy: false,
			getValue: ({ item }) => item[key],
			render: ({ item }) =>
				key === linkField ? (
					<RouterLink
						className="spacepress-schema-title-link"
						to={`/collections/${c.name}/${encodeURIComponent(String(item[c.primaryKey]))}`}
					>
						{formatCellText(item[key], col)}
					</RouterLink>
				) : (
					renderCell(item[key], key, col)
				),
		}));

	if (native(c.name) && rows.some((r) => typeof r._modified === 'string')) {
		fields.push({
			id: '_modified',
			label: 'Updated',
			type: 'text',
			enableSorting: true,
			enableGlobalSearch: false,
			filterBy: false,
			getValue: ({ item }) => item._modified,
			render: ({ item }) => (
				<span className="spacepress-schema-cell-muted">
					{formatDate(item._modified)}
				</span>
			),
		});
	}
	return fields;
}

export function CollectionList() {
	const { collection } = useParams({ from: '/collections/$collection' });
	const state = useLoad(() => collectionSpec(collection), [collection]);
	return state.kind === 'ready' ? (
		<CollectionTable key={collection} c={state.value} />
	) : (
		<Page title="Loading…"><Loading state={state} /></Page>
	);
}

function CollectionTable({ c }: { c: Collection }) {
	const collection = c.name;
	const search = object(useSearch({ from: '/collections/$collection' }));
	const navigate = useNavigate();
	const [revision, setRevision] = useState(0);
	const [actionError, setActionError] = useState('');
	const singular = singularLabel(c);
	const statusFilter = text(search.status) ?? 'all';
	const canFilterStatus = Boolean(
		c.columns.status?.options?.length &&
			c.columns.status.options.length > 1 &&
			(!native(c.name) ||
				(allowed(c.access.update, bootstrap().role) &&
					['author', 'editor', 'admin'].includes(bootstrap().role)))
	);

	const defaultView = useMemo<View>(() => {
		const titleField = c.title && c.title in c.columns ? c.title : c.primaryKey;
		const secondary = defaultListColumns(c, titleField);
		if (native(c.name) && !c.ui?.defaultColumns?.length && secondary.length < 4) {
			secondary.push('_modified');
		}
		return {
			type: 'table',
			titleField,
			fields: secondary,
			perPage: 20,
			sort: { field: c.primaryKey, direction: 'desc' },
		};
	}, [c]);

	const { view: savedView, updateView, isModified, resetToDefault } = useView({
		kind: 'spCollection',
		name: collection,
		slug: 'all',
		defaultView,
		queryParams: {
			page: Math.max(1, Number(search.page) || 1),
			search: text(search.search) ?? '',
		},
		onChangeQueryParams: (next) => {
			void navigate({
				to: `/collections/${collection}`,
				search: {
					page: next.page,
					search: next.search || undefined,
					status: statusFilter !== 'all' ? statusFilter : undefined,
				},
			});
		},
	});

	const page = savedView.page ?? 1,
		perPage = Math.min(100, Math.max(1, savedView.perPage ?? 20)),
		query = savedView.search ?? '',
		orderBy = savedView.sort?.field,
		direction = savedView.sort?.direction ?? 'desc';

	const state = useLoad(
		() =>
			list(c, {
				page,
				perPage,
				search: query,
				status: canFilterStatus ? statusFilter : undefined,
				orderBy,
				direction,
			}),
		[c, page, perPage, query, statusFilter, canFilterStatus, orderBy, direction, revision]
	);

	const deleteModal = useMemo(
		() =>
			createConfirmModal<Row>({
				modalHeader: (items) =>
					items.length === 1
						? `Delete ${singular}`
						: `Delete ${items.length} ${c.label}`,
				intent: 'delete-permanently',
				message: (items) =>
					items.length === 1
						? `Delete "${formatCellText(items[0][c.title ?? c.primaryKey])}"?`
						: `Delete ${items.length} selected items?`,
				onSubmit: async (items, setIsLoading) => {
					setIsLoading(true);
					setActionError('');
					try {
						await Promise.all(
							items.map((item) => remove(c, String(item[c.primaryKey])))
						);
						setRevision((r) => r + 1);
					} catch (e: unknown) {
						setActionError(message(e));
					}
				},
			}),
		[c, singular]
	);

	const actions = useMemo<Action<Row>[]>(() => {
		const listActions: Action<Row>[] = [
			{
				id: 'edit',
				label: 'Edit',
				isPrimary: true,
				icon: pencil,
				supportsBulk: false,
				callback: (items) => {
					const item = items[0];
					if (!item) return;
					void navigate({
						to: `/collections/${collection}/${encodeURIComponent(String(item[c.primaryKey]))}`,
					});
				},
			},
			{
				id: 'view',
				label: 'View',
				isPrimary: false,
				icon: external,
				supportsBulk: false,
				isEligible: (item) => typeof item._link === 'string' && item._link.length > 0,
				callback: (items) => {
					const url = items[0]?._link;
					if (typeof url === 'string' && url) {
						window.open(url, '_blank', 'noopener,noreferrer');
					}
				},
			},
		];
		if (allowed(c.access.delete, bootstrap().role)) {
			listActions.push({
				id: 'delete',
				label: 'Delete',
				isPrimary: false,
				icon: trash,
				supportsBulk: true,
				...deleteModal,
			});
		}
		return listActions;
	}, [c, collection, navigate, deleteModal]);

	const statusTabs = canFilterStatus ? (
		<div className="spacepress-schema-status-tabs" role="tablist" aria-label="Filter by status">
			{['all', ...(c.columns.status?.options ?? [])].map((status) => {
				const active = statusFilter === status;
				return (
					<button
						key={status}
						type="button"
						role="tab"
						aria-selected={active}
						className={`spacepress-schema-status-tab${active ? ' is-active' : ''}`}
						onClick={() => {
							void navigate({
								to: `/collections/${collection}`,
								search: {
									page: 1,
									search: query || undefined,
									status: status === 'all' ? undefined : status,
								},
							});
						}}
					>
						{status === 'all' ? 'All' : humanLabel(status)}
					</button>
				);
			})}
		</div>
	) : undefined;

	if (state.kind !== 'ready')
		return (
			<Page title={c.label} subTitle={c.ui?.description}>
				<Loading state={state} />
			</Page>
		);

	const { rows, total, hasMore } = state.value,
		fields = listFields(c, rows);
	const available = fields.map((f) => f.id);
	const titleField =
		c.title && available.includes(c.title) ? c.title : c.primaryKey;
	const secondaryFields = (savedView.fields ?? []).filter(
		(id) => id !== titleField && available.includes(id)
	);
	const view: View = {
		...savedView,
		fields: secondaryFields,
		titleField,
		page,
		perPage,
		search: query,
		sort: { field: orderBy ?? c.primaryKey, direction },
	};
	const totalItems =
		total ?? (page - 1) * perPage + rows.length + (hasMore ? 1 : 0);

	return (
		<Page
			title={c.label}
			hasPadding={false}
			subTitle={c.ui?.description}
			tabs={statusTabs}
			actions={
				<Button
					variant="primary"
					disabled={!allowed(c.access.create, bootstrap().role)}
					onClick={() => {
						void navigate({ to: `/collections/${collection}/-/new` });
					}}
				>
					New {singular}
				</Button>
			}
		>
			{actionError && (
				<Notice status="error" isDismissible onRemove={() => setActionError('')}>
					{actionError}
				</Notice>
			)}
			<DataViews<Row>
				data={rows}
				fields={fields}
				view={view}
				actions={actions}
				onChangeView={(next) => {
					updateView({
						...next,
						page: next.search !== query || next.perPage !== perPage ? 1 : next.page,
					});
				}}
				onReset={
					isModified
						? () => {
								resetToDefault();
								void navigate({
									to: `/collections/${collection}`,
									search: { page: 1, search: query || undefined },
								});
							}
						: false
				}
				getItemId={(r) => String(r[c.primaryKey])}
				defaultLayouts={{ table: {} }}
				showSearch={Boolean(c.title)}
				paginationInfo={{
					totalItems,
					totalPages: Math.max(1, Math.ceil(totalItems / perPage)),
				}}
			/>
		</Page>
	);
}

export function DocumentForm({
	fields,
	initial,
	editing,
	omit = [],
	disabled,
	submit,
	label = 'Save changes',
	onSaved,
}: {
	fields: Columns;
	initial: Row;
	editing: boolean;
	omit?: string[];
	disabled: boolean;
	submit: (changes: Row) => Promise<Row | void>;
	label?: string;
	onSaved?: (result: Row) => Promise<void>;
}) {
	const [values, setValues] = useState(initial),
		[changes, setChanges] = useState<Row>({}),
		[error, setError] = useState(''),
		[busy, setBusy] = useState(false),
		[saved, setSaved] = useState(false);
	const [objects] = useState(() => new EditingObjects());
	const drafts = useFieldDrafts({ fields, values, objects, editing, omit });
	const dirty = Object.keys(changes).length > 0;
	const saving = useRef(false);
	const [savedResult, setSavedResult] = useState<Row | null>(null);
	const saveChanges = useCallback(async () => {
		if (disabled || !drafts.valid) throw new Error('Fix errors before saving.');
		if (saving.current) throw new Error('A save is already in progress.');
		saving.current = true;
		setBusy(true);
		setError('');
		setSaved(false);
		try {
			const result = await submit(editing ? changes : values);
			if (result) setValues(result);
			setChanges({});
			setSaved(true);
			return result;
		} catch (e: unknown) {
			setError(message(e));
			throw e;
		} finally {
			saving.current = false;
			setBusy(false);
		}
	}, [disabled, drafts.valid, submit, editing, changes, values]);
	const sharedChanges = useDocumentChanges({ dirty, valid: drafts.valid, saving: busy, save: saveChanges });
	// Navigate only after the clean document state has reached the shared blocker.
	// Saving from that blocker's dialog instead follows its original destination.
	useEffect(() => {
		if (!savedResult || !onSaved || !sharedChanges || sharedChanges.dirty ||
			sharedChanges.saving || !sharedChanges.valid) return;
		setSavedResult(null);
		void onSaved(savedResult).catch((e: unknown) => setError(message(e)));
	}, [savedResult, onSaved, sharedChanges]);
	return (
		<form
			className="spacepress-schema-form"
			onSubmit={(e) => {
				e.preventDefault();
				if (disabled || busy || !drafts.valid) return;
				void saveChanges().then((result) => {
					if (result && onSaved) setSavedResult(result);
				}).catch(() => undefined);
			}}
		>
			{error && (
				<Notice status="error" isDismissible={false}>
					{error}
				</Notice>
			)}
			{saved && (
				<Notice status="success" isDismissible={false}>
					Saved.
				</Notice>
			)}
			<Fields
				fields={fields}
				values={values}
				objects={objects}
				jsonDrafts={drafts}
				editing={editing}
				omit={omit}
				disabled={disabled || busy}
				onChange={(key, v) => {
					setValues({ ...values, [key]: v });
					setChanges({ ...changes, [key]: v });
					setSaved(false);
				}}
			/>
			<Button
				type="submit"
				variant="primary"
				isBusy={busy}
				disabled={disabled || busy || !drafts.valid || (editing && !dirty)}
			>
				{label}
			</Button>
		</form>
	);
}

export function NewDocument() {
	const { collection } = useParams({ from: '/collections/$collection/-/new' });
	const state = useLoad(() => collectionSpec(collection), [collection]);
	const navigate = useNavigate();
	if (state.kind !== 'ready')
		return (
			<Page title="New record">
				<Loading state={state} />
			</Page>
		);
	const c = state.value;
	const singular = singularLabel(c);
	const initial = defaults(c.columns, (column) => allowed(column.create, bootstrap().role));
	// A content author can review blocks before publishing.
	if (c.content && c.columns.status?.options.includes('draft') &&
		allowed(c.columns.status.create, bootstrap().role))
		initial.status = 'draft';
	return (
		<Page
			title={`New ${singular}`}
			breadcrumbs={
				<RouterLink
					className="spacepress-schema-back"
					to={`/collections/${collection}`}
				>
					Back to {c.label}
				</RouterLink>
			}
			contentWidth="constrained"
		>
			{!allowed(c.access.create, bootstrap().role) && (
				<Notice status="warning" isDismissible={false}>
					You cannot create records in this collection.
				</Notice>
			)}
			<DocumentForm
				key={collection}
				fields={c.columns}
				initial={initial}
				editing={false}
				omit={[c.primaryKey]}
				disabled={!allowed(c.access.create, bootstrap().role)}
				label={`Create ${singular}`}
				submit={(values) => save(c, values)}
				onSaved={async (row) => {
					await navigate({
						to: `/collections/${collection}/${encodeURIComponent(String(row[c.primaryKey]))}`,
					});
				}}
			/>
		</Page>
	);
}

export function PlainDocument() {
	const { collection, slug: id } = useParams({
		from: '/collections/$collection/$slug',
	});
	const state = useLoad(async () => {
		const c = await collectionSpec(collection);
		return { c, ...await read(c, id) };
	}, [collection, id]);
	if (state.kind !== 'ready')
		return (
			<Page title="Edit record">
				<Loading state={state} />
			</Page>
		);
	const { c, row, editable } = state.value;
	// Content collections are rendered by the native canvas/editor route, not a second form.
	if (nativeEditor(c, row, editable)) return null;
	return (
		<Page
			title={`Edit ${singularLabel(c)}`}
			breadcrumbs={
				<RouterLink
					className="spacepress-schema-back"
					to={`/collections/${collection}`}
				>
					Back to {c.label}
				</RouterLink>
			}
			contentWidth="constrained"
		>
			<DocumentForm
				key={`${collection}/${id}`}
				fields={c.columns}
				initial={row}
				editing
				omit={[c.primaryKey]}
				disabled={!editable}
				submit={(changes) => save(c, changes, id)}
			/>
		</Page>
	);
}

export function Globals() {
	const state = useLoad(async () => {
		const s = await schema();
		return (
			await Promise.all(
				Object.entries(s.globals).map(async ([name, g]) => {
					try {
						await apiFetch({
							...api(`/${encodeURIComponent(name)}`),
						});
						return { name, label: g.label, description: g.ui?.description };
					} catch (e: unknown) {
						const error = object(e);
						const status =
							error.status ??
							(error.data ? object(error.data).status : undefined);
						if ([401, 403].includes(Number(status))) return null;
						throw e;
					}
				})
			)
		).filter((g) => g !== null);
	}, []);
	return (
		<Page title="Globals" subTitle="Site-wide structured settings and content.">
			{state.kind !== 'ready' ? (
				<Loading state={state} />
			) : (
				<div className="spacepress-schema-cards">
					{state.value.map((g) => (
						<article key={g.name}>
							<h2>
								<RouterLink to={`/globals/${g.name}`}>{g.label}</RouterLink>
							</h2>
							{g.description && <p>{g.description}</p>}
						</article>
					))}
				</div>
			)}
		</Page>
	);
}

export function GlobalDocument() {
	const { name } = useParams({ from: '/globals/$name' });
	const state = useLoad(async () => {
		const g = (await schema()).globals[name];
		if (!g) throw new Error('Global not found.');
		return {
			g,
			row: object(
				unwrap(
					await apiFetch({
						...api(`/${encodeURIComponent(name)}`),
					})
				)
			),
		};
	}, [name]);
	if (state.kind !== 'ready')
		return (
			<Page title="Global">
				<Loading state={state} />
			</Page>
		);
	const { g, row } = state.value;
	return (
		<Page title={g.label} subTitle={g.ui?.description} contentWidth="constrained">
			<DocumentForm
				key={name}
				fields={g.fields}
				initial={row}
				editing
				disabled={!allowed(g.access.update, bootstrap().role)}
				submit={async (changes) =>
					object(
						unwrap(
							await apiFetch({
								...api(`/${encodeURIComponent(name)}`),
								method: 'PATCH',
								data: changes,
							})
						)
					)
				}
			/>
		</Page>
	);
}
