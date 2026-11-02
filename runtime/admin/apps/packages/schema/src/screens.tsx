import { useEffect, useState } from 'react';
import apiFetch from '@wordpress/api-fetch';
import { useNavigate, useParams, useSearch } from '@wordpress/route';
import { Button, Notice, Spinner } from '@wordpress/components';
import { Page, RouterLink } from '@zero-admin/admin-toolkit';
import { DataViews, type Field, type View } from '@zero-admin/dataviews';
import {
	allowed,
	defaults,
	object,
	text,
	type Row,
	type Collection,
	type Columns,
} from './model';
import {
	bootstrap,
	collectionSpec,
	list,
	message,
	native,
	read,
	save,
	schema,
	unwrap,
	useLoad,
	type Load,
} from './api';
import { Fields } from './fields';
import './style.scss';

export function Loading({ state }: { state: Load<unknown> }) {
	return state.kind === 'error' ? (
		<div role="alert">
			<Notice status="error" isDismissible={false}>
				{state.message}
			</Notice>
		</div>
	) : (
		<div role="status">
			<Spinner />
			Loading…
		</div>
	);
}
export function Overview() {
	const state = useLoad(schema, []);
	return (
		<Page title="Collections" subTitle="Your app’s content, in one place.">
			{state.kind !== 'ready' ? (
				<Loading state={state} />
			) : (
				<div className="zero-schema-cards">
					{Object.values(state.value.collections)
						.filter((c) => bootstrap().readable.includes(c.name))
						.map((c) => (
							<article key={c.name}>
								<h2>
									<RouterLink to={`/collections/${c.name}`}>
										{c.label}
									</RouterLink>
								</h2>
								<p>{c.storage ?? (native(c.name) ? 'Collection' : 'Table')}</p>
								<p>{Object.keys(c.columns).length} fields</p>
							</article>
						))}
				</div>
			)}
		</Page>
	);
}
function display(value: unknown): string {
	return value == null
		? '—'
		: typeof value === 'object'
			? JSON.stringify(value)
			: String(value);
}
export function listFields(c: Collection, rows: Row[]): Field<Row>[] {
	const linkField =
		c.title && rows.some((r) => c.title && c.title in r)
			? c.title
			: c.primaryKey;
	return Object.entries(c.columns)
		.filter(([key]) => key === c.primaryKey || rows.some((r) => key in r))
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
			getValue: ({ item }) => item[key],
			render: ({ item }) =>
				key === linkField ? (
					<RouterLink
						to={`/collections/${c.name}/${encodeURIComponent(String(item[c.primaryKey]))}`}
					>
						{display(item[key])}
					</RouterLink>
				) : (
					<span>{display(item[key])}</span>
				),
		}));
}
export function CollectionList() {
	const { collection } = useParams({ from: '/collections/$collection' });
	const search = object(useSearch({ from: '/collections/$collection' }));
	const navigate = useNavigate();
	const page = Math.max(1, Number(search.page) || 1),
		perPage = Math.min(100, Math.max(10, Number(search.perPage) || 20));
	const query = text(search.search) ?? '',
		orderBy = text(search.orderBy),
		direction = search.direction === 'asc' ? 'asc' : 'desc';
	const state = useLoad(async () => {
		const c = await collectionSpec(collection);
		return {
			c,
			...(await list(c, { page, perPage, search: query, orderBy, direction })),
		};
	}, [collection, page, perPage, query, orderBy, direction]);
	const [layout, setLayout] = useState<View>({ type: 'table', fields: [] });
	if (state.kind !== 'ready')
		return (
			<Page title="Collection">
				<Loading state={state} />
			</Page>
		);
	const { c, rows, total, hasMore } = state.value,
		fields = listFields(c, rows);
	const available = fields.map((f) => f.id);
	const titleField =
		c.title && available.includes(c.title) ? c.title : c.primaryKey;
	const initial = [
		titleField,
		...fields
			.map((f) => f.id)
			.filter((id) => id !== c.title && id !== c.primaryKey),
	].slice(0, 5);
	const view: View = {
		...layout,
		fields: layout.fields?.length
			? layout.fields.filter((id) => available.includes(id))
			: initial,
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
			subTitle={c.storage ?? (native(c.name) ? 'Collection' : 'Table')}
			actions={
				<Button
					variant="primary"
					disabled={!allowed(c.access.create, bootstrap().role)}
					onClick={() => {
						void navigate({ to: `/collections/${collection}/-/new` });
					}}
				>
					New {c.label}
				</Button>
			}
		>
			{!native(c.name) && c.title && (
				<p>Search matches the {c.columns[c.title]?.label ?? c.title} field.</p>
			)}
			<DataViews<Row>
				data={rows}
				fields={fields}
				view={view}
				onChangeView={(next) => {
					setLayout(next);
					void navigate({
						to: `/collections/${collection}`,
						search: {
							page: next.search !== query ? 1 : next.page,
							perPage: next.perPage,
							search: next.search || undefined,
							orderBy: next.sort?.field,
							direction: next.sort?.direction,
						},
					});
				}}
				getItemId={(r) => String(r[c.primaryKey])}
				defaultLayouts={{ table: {} }}
				search={Boolean(c.title)}
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
}: {
	fields: Columns;
	initial: Row;
	editing: boolean;
	omit?: string[];
	disabled: boolean;
	submit: (changes: Row) => Promise<Row | void>;
	label?: string;
}) {
	const [values, setValues] = useState(initial),
		[changes, setChanges] = useState<Row>({}),
		[error, setError] = useState(''),
		[busy, setBusy] = useState(false),
		[saved, setSaved] = useState(false);
	const dirty = Object.keys(changes).length > 0;
	useEffect(() => {
		if (!dirty) return;
		const warn = (e: BeforeUnloadEvent) => {
			e.preventDefault();
		};
		window.addEventListener('beforeunload', warn);
		return () => window.removeEventListener('beforeunload', warn);
	}, [dirty]);
	return (
		<form
			className="zero-schema-form"
			onSubmit={(e) => {
				e.preventDefault();
				if (disabled || busy) return;
				setBusy(true);
				setError('');
				setSaved(false);
				submit(editing ? changes : values)
					.then(
						(result) => {
							if (result) setValues(result);
							setChanges({});
							setSaved(true);
						},
						(e: unknown) => setError(message(e))
					)
					.finally(() => setBusy(false));
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
				disabled={disabled || busy || (editing && !dirty)}
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
	const initial = defaults(c.columns);
	// A content author can review blocks before publishing.
	if (c.content && c.columns.status?.options.includes('draft'))
		initial.status = 'draft';
	return (
		<Page
			title={`New ${c.label}`}
			breadcrumbs={
				<RouterLink
					className="zero-schema-back"
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
				label="Create record"
				submit={async (values) => {
					const row = await save(c, values);
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
		return { c, row: await read(c, id) };
	}, [collection, id]);
	if (state.kind !== 'ready')
		return (
			<Page title="Edit record">
				<Loading state={state} />
			</Page>
		);
	const { c, row } = state.value;
	// Content collections are rendered by the native canvas/editor route, not a second form.
	if (c.content && native(collection)) return null;
	return (
		<Page
			title={`Edit ${c.label}`}
			breadcrumbs={
				<RouterLink
					className="zero-schema-back"
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
				disabled={!allowed(c.access.update, bootstrap().role)}
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
							path: `/zero/v1/globals/${encodeURIComponent(name)}`,
						});
						return { name, label: g.label };
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
		<Page title="Globals">
			{state.kind !== 'ready' ? (
				<Loading state={state} />
			) : (
				<div className="zero-schema-cards">
					{state.value.map((g) => (
						<article key={g.name}>
							<h2>
								<RouterLink to={`/globals/${g.name}`}>{g.label}</RouterLink>
							</h2>
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
						path: `/zero/v1/globals/${encodeURIComponent(name)}`,
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
		<Page title={g.label} contentWidth="constrained">
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
								path: `/zero/v1/globals/${encodeURIComponent(name)}`,
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
