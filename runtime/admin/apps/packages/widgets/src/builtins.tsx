import { useEffect, useState } from 'react';
import { Spinner } from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import {
	globe,
	listView,
	postContent,
	postList,
	store as storeIcon,
} from '@wordpress/icons';
import { RouterLink } from '@typedpress-admin/admin-toolkit';
import {
	store as tpAdminStore,
	type StoreSelectors,
} from '@typedpress-admin/boot';
import type {
	DashboardWidgetType,
	WidgetRenderProps,
} from '@typedpress-admin/dashboard';
import {
	allowed,
	bootstrap,
	list,
	native,
	schema,
	singularLabel,
	type Collection,
	type Row,
} from '@typedpress-admin/schema';

function formatShortDate(value: unknown): string {
	if (typeof value !== 'string' || !value) return '';
	const normalized =
		value.includes('T') && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)
			? `${value}Z`
			: value;
	const d = new Date(normalized);
	if (Number.isNaN(d.getTime())) return '';
	return new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
	}).format(d);
}

function rowTitle(c: Collection, row: Row): string {
	const raw = c.title ? row[c.title] : row[c.primaryKey];
	if (raw == null || raw === '') return `#${String(row[c.primaryKey])}`;
	return String(raw);
}

/**
 * 1. Content Overview: live counts per readable collection & table + direct create actions.
 */
function ContentOverviewWidget({ setError }: WidgetRenderProps) {
	const [items, setItems] = useState<
		Array<{
			collection: Collection;
			count: number | null;
			canCreate: boolean;
		}>
	>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let active = true;
		const boot = bootstrap();
		schema()
			.then(async (s) => {
				const readable = Object.values(s.collections).filter(
					(c) => boot.readable.includes(c.name) && !c.ui?.hidden
				);
				const counts = await Promise.all(
					readable.slice(0, 8).map(async (c) => {
						try {
							const res = await list(c, { page: 1, perPage: 1 });
							return {
								collection: c,
								count:
									res.total !== undefined
										? res.total
										: res.hasMore
											? null
											: res.rows.length,
								canCreate: allowed(c.access.create, boot.role),
							};
						} catch {
							return {
								collection: c,
								count: null,
								canCreate: allowed(c.access.create, boot.role),
							};
						}
					})
				);
				if (active) {
					setItems(counts);
					setLoading(false);
				}
			})
			.catch((err: unknown) => {
				if (!active) return;
				setLoading(false);
				setError?.({
					message:
						err instanceof Error ? err.message : 'Unable to load collections.',
				});
			});
		return () => {
			active = false;
		};
	}, [setError]);

	if (loading) {
		return (
			<div className="tp-widget__loading">
				<Spinner />
				<span>Loading collections…</span>
			</div>
		);
	}

	if (items.length === 0) {
		return (
			<div className="tp-widget__empty">
				No collections defined in this app yet.
			</div>
		);
	}

	return (
		<div className="tp-widget">
			<ul className="tp-widget__list">
				{items.map(({ collection: c, count, canCreate }) => (
					<li key={c.name} className="tp-widget__row">
						<div className="tp-widget__row-main">
							<RouterLink
								className="tp-widget__row-title"
								to={`/collections/${c.name}`}
							>
								{c.label}
							</RouterLink>
							{c.ui?.description && (
								<span className="tp-widget__row-meta">
									{c.ui.description}
								</span>
							)}
						</div>
						<div className="tp-widget__row-actions">
							{count !== null && (
								<span className="tp-widget__count">{count}</span>
							)}
							{canCreate && (
								<RouterLink
									className="tp-widget__link-chip"
									to={`/collections/${c.name}/-/new`}
								>
									+ {singularLabel(c)}
								</RouterLink>
							)}
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * 2. Recent Activity: recently updated items across readable collections.
 */
function RecentActivityWidget({ setError }: WidgetRenderProps) {
	const [entries, setEntries] = useState<
		Array<{
			id: string;
			title: string;
			collectionLabel: string;
			to: string;
			updated: string;
			sortKey: number;
		}>
	>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let active = true;
		const boot = bootstrap();
		schema()
			.then(async (s) => {
				const readable = Object.values(s.collections)
					.filter((c) => boot.readable.includes(c.name) && !c.ui?.hidden)
					.slice(0, 4);
				const batches = await Promise.all(
					readable.map(async (c) => {
						try {
							const res = await list(c, {
								page: 1,
								perPage: 5,
								orderBy: native(c.name) ? '_modified' : c.primaryKey,
								direction: 'desc',
							});
							return res.rows.map((row) => {
								const rawDate =
									(typeof row._modified === 'string' && row._modified) ||
									(typeof row.publishedAt === 'string' && row.publishedAt) ||
									'';
								const ts = rawDate ? Date.parse(rawDate) : 0;
								return {
									id: `${c.name}:${String(row[c.primaryKey])}`,
									title: rowTitle(c, row),
									collectionLabel: c.label,
									to: `/collections/${c.name}/${encodeURIComponent(String(row[c.primaryKey]))}`,
									updated: formatShortDate(rawDate),
									sortKey: Number.isNaN(ts) ? 0 : ts,
								};
							});
						} catch {
							return [];
						}
					})
				);
				const merged = batches
					.flat()
					.sort((a, b) => b.sortKey - a.sortKey)
					.slice(0, 7);
				if (active) {
					setEntries(merged);
					setLoading(false);
				}
			})
			.catch((err: unknown) => {
				if (!active) return;
				setLoading(false);
				setError?.({
					message:
						err instanceof Error ? err.message : 'Unable to load recent activity.',
				});
			});
		return () => {
			active = false;
		};
	}, [setError]);

	if (loading) {
		return (
			<div className="tp-widget__loading">
				<Spinner />
				<span>Loading recent updates…</span>
			</div>
		);
	}

	if (entries.length === 0) {
		return <div className="tp-widget__empty">No recent entries yet.</div>;
	}

	return (
		<div className="tp-widget">
			<ul className="tp-widget__list">
				{entries.map((entry) => (
					<li key={entry.id} className="tp-widget__row">
						<div className="tp-widget__row-main">
							<RouterLink className="tp-widget__row-title" to={entry.to}>
								{entry.title}
							</RouterLink>
							<span className="tp-widget__row-meta">
								<span className="tp-widget__pill">{entry.collectionLabel}</span>
								{entry.updated && <span>{entry.updated}</span>}
							</span>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * 3. Drafts & Review Queue: draft and scheduled content awaiting publication.
 */
function DraftsQueueWidget({ setBadge, setError }: WidgetRenderProps) {
	const [drafts, setDrafts] = useState<
		Array<{
			id: string;
			title: string;
			collectionLabel: string;
			status: string;
			to: string;
		}>
	>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let active = true;
		const boot = bootstrap();
		schema()
			.then(async (s) => {
				const candidates = Object.values(s.collections)
					.filter(
						(c) =>
							boot.readable.includes(c.name) &&
							!c.ui?.hidden &&
							Boolean(c.columns.status?.options?.includes('draft'))
					)
					.slice(0, 4);
				const batches = await Promise.all(
					candidates.map(async (c) => {
						try {
							const res = await list(c, {
								page: 1,
								perPage: 5,
								status: 'draft',
							});
							return res.rows.map((row) => ({
								id: `${c.name}:${String(row[c.primaryKey])}`,
								title: rowTitle(c, row),
								collectionLabel: c.label,
								status: String(row.status ?? 'draft'),
								to: `/collections/${c.name}/${encodeURIComponent(String(row[c.primaryKey]))}`,
							}));
						} catch {
							return [];
						}
					})
				);
				const all = batches.flat().slice(0, 6);
				if (active) {
					setDrafts(all);
					setBadge?.(all.length > 0 ? all.length : null);
					setLoading(false);
				}
			})
			.catch((err: unknown) => {
				if (!active) return;
				setLoading(false);
				setError?.({
					message:
						err instanceof Error ? err.message : 'Unable to load drafts.',
				});
			});
		return () => {
			active = false;
		};
	}, [setBadge, setError]);

	if (loading) {
		return (
			<div className="tp-widget__loading">
				<Spinner />
				<span>Checking drafts…</span>
			</div>
		);
	}

	if (drafts.length === 0) {
		return (
			<div className="tp-widget__empty">
				All clear — no drafts waiting to be published.
			</div>
		);
	}

	return (
		<div className="tp-widget">
			<ul className="tp-widget__list">
				{drafts.map((item) => (
					<li key={item.id} className="tp-widget__row">
						<div className="tp-widget__row-main">
							<RouterLink className="tp-widget__row-title" to={item.to}>
								{item.title}
							</RouterLink>
							<span className="tp-widget__row-meta">
								<span>{item.collectionLabel}</span>
							</span>
						</div>
						<span className="tp-widget__pill is-warning">{item.status}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * 4. App & Site Status: live schema summary + quick links to Design, Globals, Identity, Settings.
 */
function AppStatusWidget() {
	const context = useSelect(
		(select) =>
			(select(tpAdminStore) as StoreSelectors).getDashboardContext(),
		[]
	);
	const [summary, setSummary] = useState<{
		collections: number;
		tables: number;
		globals: number;
	} | null>(null);

	useEffect(() => {
		let active = true;
		schema()
			.then((s) => {
				if (!active) return;
				const all = Object.values(s.collections);
				const tables = all.filter((c) => c.storage === 'table').length;
				setSummary({
					collections: all.length - tables,
					tables,
					globals: Object.keys(s.globals).length,
				});
			})
			.catch(() => {
				if (active) setSummary({ collections: 0, tables: 0, globals: 0 });
			});
		return () => {
			active = false;
		};
	}, []);

	return (
		<div className="tp-widget">
			<div className="tp-widget__metrics">
				<div className="tp-widget__metric">
					<span className="tp-widget__metric-label">Collections</span>
					<span className="tp-widget__metric-value">
						{summary ? summary.collections : '—'}
					</span>
				</div>
				<div className="tp-widget__metric">
					<span className="tp-widget__metric-label">Tables</span>
					<span className="tp-widget__metric-value">
						{summary ? summary.tables : '—'}
					</span>
				</div>
				<div className="tp-widget__metric">
					<span className="tp-widget__metric-label">Globals</span>
					<span className="tp-widget__metric-value">
						{summary ? summary.globals : '—'}
					</span>
				</div>
			</div>
			<dl className="tp-widget__summary">
				<div className="tp-widget__summary-row">
					<dt>Runtime</dt>
					<dd>{context?.managed ? 'SpaceFast Managed' : 'Self-Hosted'}</dd>
				</div>
				{Array.isArray(context?.dashboards) && context.dashboards.length > 0 && (
					<div className="tp-widget__summary-row">
						<dt>Custom Dashboards</dt>
						<dd>{context.dashboards.length}</dd>
					</div>
				)}
			</dl>
			<div className="tp-widget__quick-links">
				<RouterLink className="tp-widget__link-chip" to="/styles">
					Design
				</RouterLink>
				{summary && summary.globals > 0 && (
					<RouterLink className="tp-widget__link-chip" to="/globals">
						Globals
					</RouterLink>
				)}
				{context?.identity_active && (
					<RouterLink className="tp-widget__link-chip" to="/identity">
						Identity
					</RouterLink>
				)}
				<RouterLink className="tp-widget__link-chip" to="/settings/general">
					Settings
				</RouterLink>
			</div>
		</div>
	);
}

/**
 * 5. Store Pulse: products & orders summary when Commerce is enabled.
 */
function StorePulseWidget({ setError }: WidgetRenderProps) {
	const [stats, setStats] = useState<
		Array<{ name: string; label: string; count: number | null; to: string }>
	>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let active = true;
		const boot = bootstrap();
		schema()
			.then(async (s) => {
				const commerce = Object.values(s.collections).filter(
					(c) =>
						boot.readable.includes(c.name) &&
						(c.ui?.group === 'commerce' ||
							/product|order|cart|customer|subscription/i.test(c.name))
				);
				const resolved = await Promise.all(
					commerce.slice(0, 4).map(async (c) => {
						try {
							const res = await list(c, { page: 1, perPage: 1 });
							return {
								name: c.name,
								label: c.label,
								count:
									res.total !== undefined
										? res.total
										: res.hasMore
											? null
											: res.rows.length,
								to: `/collections/${c.name}`,
							};
						} catch {
							return {
								name: c.name,
								label: c.label,
								count: null,
								to: `/collections/${c.name}`,
							};
						}
					})
				);
				if (active) {
					setStats(resolved);
					setLoading(false);
				}
			})
			.catch((err: unknown) => {
				if (!active) return;
				setLoading(false);
				setError?.({
					message:
						err instanceof Error ? err.message : 'Unable to load store metrics.',
				});
			});
		return () => {
			active = false;
		};
	}, [setError]);

	if (loading) {
		return (
			<div className="tp-widget__loading">
				<Spinner />
				<span>Loading store…</span>
			</div>
		);
	}

	if (stats.length === 0) {
		return (
			<div className="tp-widget__empty">
				Store is active. Add products or orders to see live metrics here.
			</div>
		);
	}

	return (
		<div className="tp-widget">
			<div className="tp-widget__metrics">
				{stats.map((item) => (
					<RouterLink
						key={item.name}
						to={item.to}
						className="tp-widget__metric"
						style={{ textDecoration: 'none' }}
					>
						<span className="tp-widget__metric-label">{item.label}</span>
						<span className="tp-widget__metric-value">
							{item.count !== null ? item.count : '—'}
						</span>
					</RouterLink>
				))}
			</div>
		</div>
	);
}

export const BUILTIN_WIDGET_TYPES: DashboardWidgetType<unknown>[] = [
	{
		name: 'tp/content-overview',
		title: 'Content Overview',
		description: 'Live counts and quick create actions for your collections.',
		icon: postContent,
		example: {},
		defaults: { width: 2, height: 2 },
		render: ContentOverviewWidget,
	},
	{
		name: 'tp/recent-activity',
		title: 'Recent Activity',
		description: 'Recently updated entries across your collections.',
		icon: listView,
		example: {},
		defaults: { width: 2, height: 2 },
		render: RecentActivityWidget,
	},
	{
		name: 'tp/drafts-queue',
		title: 'Drafts & Review',
		description: 'Draft entries waiting to be published.',
		icon: postList,
		example: {},
		defaults: { width: 2, height: 2 },
		render: DraftsQueueWidget,
	},
	{
		name: 'tp/app-status',
		title: 'Site & App Status',
		description: 'Schema overview and shortcuts to site settings.',
		icon: globe,
		example: {},
		defaults: { width: 2, height: 2 },
		render: AppStatusWidget,
	},
	{
		name: 'tp/store-pulse',
		title: 'Store Pulse',
		description: 'Live product and order totals for your storefront.',
		icon: storeIcon,
		example: {},
		defaults: { width: 2, height: 2 },
		render: StorePulseWidget,
	},
];
