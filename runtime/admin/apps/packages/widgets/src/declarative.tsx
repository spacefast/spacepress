import { useCallback, useEffect, useState } from 'react';
import apiFetch from '@wordpress/api-fetch';
import { Button, Spinner } from '@wordpress/components';
import { chartBar, listView, postList, table as tableIcon } from '@wordpress/icons';
import { RouterLink } from '@typedpress-admin/admin-toolkit';
import type {
	DeclarativeWidgetDefinition,
	DeclarativeWidgetField,
} from '@typedpress-admin/boot';
import type { DashboardWidgetType, WidgetRenderProps } from '@typedpress-admin/dashboard';

function atPath(value: unknown, path?: string): unknown {
	if (!path) return value;
	return path.split('.').reduce<unknown>(
		(acc, key) =>
			acc !== null && typeof acc === 'object'
				? (acc as Record<string, unknown>)[key]
				: undefined,
		value
	);
}

function buildAbilityPath(ability: string, input?: Record<string, unknown>): string {
	const base = `/wp-abilities/v1/abilities/${ability}/run`;
	if (!input || Object.keys(input).length === 0) return base;
	const query = new URLSearchParams();
	const append = (prefix: string, val: unknown) => {
		if (val === null || val === undefined) return;
		if (typeof val === 'object') {
			for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
				append(`${prefix}[${k}]`, v);
			}
		} else {
			query.append(prefix, String(val));
		}
	};
	for (const [k, v] of Object.entries(input)) {
		append(`input[${k}]`, v);
	}
	return `${base}?${query.toString()}`;
}

function formatMetricValue(value: unknown, format?: string): string {
	if (value === null || value === undefined) return '—';
	if (typeof value === 'number') {
		if (format === 'currency') {
			return new Intl.NumberFormat(undefined, {
				style: 'currency',
				currency: 'USD',
				maximumFractionDigits: 2,
			}).format(value);
		}
		if (format === 'percent') {
			return `${value}%`;
		}
		return new Intl.NumberFormat().format(value);
	}
	return String(value);
}

function formatFieldValue(value: unknown, format?: string): string {
	if (value === null || value === undefined || value === '') return '—';
	if (format === 'date' && typeof value === 'string') {
		const d = new Date(value);
		if (!Number.isNaN(d.getTime())) {
			return new Intl.DateTimeFormat(undefined, {
				month: 'short',
				day: 'numeric',
			}).format(d);
		}
	}
	if (format === 'number' && typeof value === 'number') {
		return new Intl.NumberFormat().format(value);
	}
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}

function DeclarativeWidgetBody({
	definition,
	setError,
}: {
	definition: DeclarativeWidgetDefinition;
	setError?: WidgetRenderProps['setError'];
}) {
	const [data, setData] = useState<unknown>(null);
	const [loading, setLoading] = useState(true);
	const [tick, setTick] = useState(0);

	const ability = definition.ability || definition.action;

	const reload = useCallback(() => {
		setTick((n) => n + 1);
	}, []);

	useEffect(() => {
		let active = true;
		setLoading(true);
		setError?.(null);
		apiFetch({ path: buildAbilityPath(ability, definition.input) })
			.then((res) => {
				if (active) {
					setData(res);
					setLoading(false);
				}
			})
			.catch((err: unknown) => {
				if (!active) return;
				setLoading(false);
				const msg =
					err && typeof err === 'object' && 'message' in err
						? String((err as { message: unknown }).message)
						: 'Unable to load widget data.';
				setError?.({
					message: msg,
					action: { label: 'Retry', onClick: reload },
				});
			});
		return () => {
			active = false;
		};
	}, [ability, definition.input, tick, reload, setError]);

	if (loading) {
		return (
			<div className="tp-widget__loading">
				<Spinner />
				<span>Loading…</span>
			</div>
		);
	}

	const display = definition.display ?? 'summary';

	let body: React.ReactNode = null;

	if (display === 'metrics') {
		const metrics = definition.metrics ?? [];
		const record =
			data && typeof data === 'object' && !Array.isArray(data)
				? (data as Record<string, unknown>)
				: {};
		const entries =
			metrics.length > 0
				? metrics.map((m) => ({
						key: m.key,
						label: m.label,
						value: formatMetricValue(atPath(record, m.key), m.format),
					}))
				: Object.entries(record).map(([key, val]) => ({
						key,
						label: key,
						value: formatMetricValue(val),
					}));
		body = entries.length ? (
			<div className="tp-widget__metrics">
				{entries.map((entry) => (
					<div key={entry.key} className="tp-widget__metric">
						<span className="tp-widget__metric-label">{entry.label}</span>
						<span className="tp-widget__metric-value">{entry.value}</span>
					</div>
				))}
			</div>
		) : (
			<div className="tp-widget__empty">No metrics available.</div>
		);
	} else if (display === 'list' || display === 'table') {
		const rawList = atPath(data, definition.items);
		const rows = Array.isArray(rawList)
			? rawList.filter(
					(r): r is Record<string, unknown> => r !== null && typeof r === 'object'
				)
			: [];
		const fields: DeclarativeWidgetField[] =
			definition.fields && definition.fields.length > 0
				? definition.fields
				: rows[0]
					? Object.keys(rows[0])
							.slice(0, 4)
							.map((key) => ({ key, label: key }))
					: [];

		if (rows.length === 0) {
			body = <div className="tp-widget__empty">No items to display.</div>;
		} else if (display === 'table') {
			body = (
				<div className="tp-widget__table-wrap">
					<table className="tp-widget__table">
						<thead>
							<tr>
								{fields.map((f) => (
									<th key={f.key}>{f.label}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rows.slice(0, 10).map((row, idx) => (
								<tr key={String(row.id ?? idx)}>
									{fields.map((f) => (
										<td key={f.key}>
											{f.format === 'badge' ? (
												<span className="tp-widget__pill">
													{formatFieldValue(atPath(row, f.key))}
												</span>
											) : (
												formatFieldValue(atPath(row, f.key), f.format)
											)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		} else {
			const [primary, ...secondary] = fields;
			body = (
				<ul className="tp-widget__list">
					{rows.slice(0, 8).map((row, idx) => (
						<li key={String(row.id ?? idx)} className="tp-widget__row">
							<div className="tp-widget__row-main">
								<span className="tp-widget__row-title">
									{primary
										? formatFieldValue(atPath(row, primary.key), primary.format)
										: `#${idx + 1}`}
								</span>
								{secondary.length > 0 && (
									<span className="tp-widget__row-meta">
										{secondary
											.slice(0, 2)
											.map((f) =>
												formatFieldValue(atPath(row, f.key), f.format)
											)
											.join(' · ')}
									</span>
								)}
							</div>
						</li>
					))}
				</ul>
			);
		}
	} else {
		const record =
			data && typeof data === 'object' && !Array.isArray(data)
				? (data as Record<string, unknown>)
				: { Value: data };
		const fields =
			definition.fields && definition.fields.length > 0
				? definition.fields.map((f) => ({
						key: f.key,
						label: f.label,
						value: formatFieldValue(atPath(record, f.key), f.format),
					}))
				: Object.entries(record)
						.slice(0, 8)
						.map(([key, val]) => ({
							key,
							label: key,
							value: formatFieldValue(val),
						}));
		body = (
			<dl className="tp-widget__summary">
				{fields.map((f) => (
					<div key={f.key} className="tp-widget__summary-row">
						<dt>{f.label}</dt>
						<dd>{f.value}</dd>
					</div>
				))}
			</dl>
		);
	}

	return (
		<div className="tp-widget">
			{body}
			<div className="tp-widget__footer">
				{definition.link ? (
					<RouterLink to={definition.link.to} className="tp-widget__link-chip">
						{definition.link.label}
					</RouterLink>
				) : (
					<span />
				)}
				<Button variant="tertiary" size="small" onClick={reload}>
					Refresh
				</Button>
			</div>
		</div>
	);
}

function widgetIcon(display?: string) {
	switch (display) {
		case 'metrics':
			return chartBar;
		case 'table':
			return tableIcon;
		case 'list':
			return listView;
		default:
			return postList;
	}
}

export function toDashboardWidgetType(
	definition: DeclarativeWidgetDefinition
): DashboardWidgetType<unknown> {
	const RenderComponent = (props: WidgetRenderProps<unknown>) => (
		<DeclarativeWidgetBody definition={definition} setError={props.setError} />
	);
	return {
		name: definition.type || `tp-widget/${definition.id}`,
		title: definition.title,
		description: definition.description,
		info: definition.info,
		icon: widgetIcon(definition.display),
		example: {},
		defaults: {
			width: definition.width ?? 2,
			height: definition.height ?? 2,
		},
		render: RenderComponent,
	};
}
