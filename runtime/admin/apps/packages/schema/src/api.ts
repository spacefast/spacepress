import apiFetch from '@wordpress/api-fetch';
import { useEffect, useState } from 'react';
import {
	object,
	map,
	parseSchema,
	text,
	strings,
	allowed,
	type Row,
	type Collection,
	type Column,
} from './model';
declare global {
	interface Window {
		zeroAdmin?: unknown;
	}
}
export function bootstrap() {
	const b = object(window.zeroAdmin);
	const native = Object.fromEntries(
		Object.entries(map(b.native)).map(([name, raw]) => {
			const n = object(raw),
				path = text(n.path),
				postType = text(n.postType);
			if (!path || !postType)
				throw new Error('Missing native collection transport.');
			return [
				name,
				{ path, postType, metaPrefix: text(n.metaPrefix) ?? 'zero_' },
			];
		})
	);
	return {
		native,
		readable: strings(b.readable),
		role: text(b.role) ?? 'subscriber',
	};
}
export function native(collection: string) {
	return bootstrap().native[collection];
}
export function endpoint(collection: string) {
	return (
		native(collection)?.path ?? `/zero/v1/${encodeURIComponent(collection)}`
	);
}
export function unwrap(value: unknown): unknown {
	const r = object(value);
	return 'data' in r ? r.data : r;
}
export async function schema() {
	return parseSchema(unwrap(await apiFetch({ path: '/zero/v1/_schema' })));
}
export async function collectionSpec(name: string) {
	const c = (await schema()).collections[name];
	if (!c) throw new Error('Collection not found.');
	return c;
}
export function message(error: unknown): string {
	if (error instanceof Error) return error.message;
	try {
		const e = object(error),
			d = e.data && typeof e.data === 'object' ? object(e.data) : {};
		return [
			text(e.detail) ?? text(e.message) ?? 'Request failed.',
			text(e.pointer) ?? text(d.pointer),
		]
			.filter(Boolean)
			.join(' ');
	} catch {
		return 'Request failed.';
	}
}
export type Load<T> =
	| { kind: 'loading' }
	| { kind: 'error'; message: string }
	| { kind: 'ready'; value: T };
export function useLoad<T>(
	load: () => Promise<T>,
	deps: readonly unknown[]
): Load<T> {
	const [state, setState] = useState<Load<T>>({ kind: 'loading' });
	useEffect(() => {
		let active = true;
		setState({ kind: 'loading' });
		load().then(
			(value) => {
				if (active) setState({ kind: 'ready', value });
			},
			(e: unknown) => {
				if (active) setState({ kind: 'error', message: message(e) });
			}
		);
		return () => {
			active = false;
		};
	}, deps);
	return state;
}
/** SCF uses its own block discriminator and JSON scalar representation. */
function scfValue(
	column: Column | undefined,
	value: unknown,
	outgoing: boolean
): unknown {
	if (!column || value == null || value === false) return value;
	if (column.type === 'json') {
		if (outgoing) return JSON.stringify(value);
		if (typeof value === 'string') {
			try {
				const parsed: unknown = JSON.parse(value);
				return parsed;
			} catch {
				return value;
			}
		}
	}
	if (column.type === 'group')
		return scfFields(column.fields, object(value), outgoing);
	if (column.type === 'repeater' && Array.isArray(value))
		return value.map((v: unknown) =>
			scfFields(column.fields, object(v), outgoing)
		);
	if (column.type === 'blocks' && Array.isArray(value))
		return value.map((v: unknown) => {
			const row = object(v),
				layout = text(row.layout) ?? text(row.acf_fc_layout) ?? '';
			const converted = scfFields(column.layouts[layout] ?? {}, row, outgoing);
			delete converted.layout;
			delete converted.acf_fc_layout;
			return { [outgoing ? 'acf_fc_layout' : 'layout']: layout, ...converted };
		});
	return value;
}
function scfFields(
	fields: Record<string, Column>,
	values: Row,
	outgoing: boolean
): Row {
	return Object.fromEntries(
		Object.entries(values).map(([k, v]) => [
			k,
			scfValue(fields[k], v, outgoing),
		])
	);
}
export function collectionForPostType(postType: string): string {
	return (
		Object.entries(bootstrap().native).find(
			([, n]) => n.postType === postType
		)?.[0] ?? postType
	);
}
export function fromNative(c: Collection, value: unknown): Row {
	const r = object(value),
		result: Row =
			r.acf && !Array.isArray(r.acf)
				? Object.fromEntries(
						Object.entries(object(r.acf))
							.filter(
								([k]) =>
									k.startsWith(native(c.name).metaPrefix) &&
									k.slice(native(c.name).metaPrefix.length) in c.columns
							)
							.map(([k, v]) => [
								k.startsWith(native(c.name).metaPrefix)
									? k.slice(native(c.name).metaPrefix.length)
									: k,
								scfValue(
									c.columns[k.slice(native(c.name).metaPrefix.length)],
									v,
									false
								),
							])
					)
				: {};
	const core = (key: string, col: string | undefined) => {
		if (!col || !(key in r)) return;
		const v = r[key];
		result[col] =
			v && typeof v === 'object' ? (object(v).raw ?? object(v).rendered) : v;
	};
	core('id', c.primaryKey);
	core('title', c.title);
	core('content', c.content);
	core('slug', c.slug);
	core('status', 'status');
	core('date_gmt', 'publishedAt');
	if (result.status === 'publish') result.status = 'published';
	if (result.status === 'future') result.status = 'scheduled';
	return result;
}
export function toNative(c: Collection, values: Row): Row {
	const result: Row = {},
		acf: Row = {};
	for (const [key, v] of Object.entries(values)) {
		if (key === c.primaryKey) continue;
		if (key === c.title) result.title = v;
		else if (key === c.content) result.content = v;
		else if (key === c.slug) result.slug = v;
		else if (key === 'status')
			result.status =
				v === 'published' ? 'publish' : v === 'scheduled' ? 'future' : v;
		else if (key === 'publishedAt') result.date_gmt = v;
		else
			acf[native(c.name).metaPrefix + key] = scfValue(c.columns[key], v, true);
	}
	if (Object.keys(acf).length) result.acf = acf;
	return result;
}
export async function read(c: Collection, id: string): Promise<Row> {
	const context = allowed(c.access.update, bootstrap().role) ? 'edit' : 'view';
	const v = await apiFetch({
		path: `${endpoint(c.name)}/${encodeURIComponent(id)}${native(c.name) ? `?context=${context}` : ''}`,
	});
	return native(c.name) ? fromNative(c, v) : object(unwrap(v));
}
export async function save(
	c: Collection,
	values: Row,
	id?: string
): Promise<Row> {
	const v = await apiFetch({
		path: `${endpoint(c.name)}${id ? '/' + encodeURIComponent(id) : ''}`,
		method: id && !native(c.name) ? 'PATCH' : 'POST',
		data: native(c.name) ? toNative(c, values) : values,
	});
	return native(c.name) ? fromNative(c, v) : object(unwrap(v));
}
/** parse:false keeps pagination headers; parse the same problem body on failures. */
export async function response(path: string): Promise<Response> {
	try {
		return await apiFetch({ path, parse: false });
	} catch (e: unknown) {
		if (e instanceof Response) {
			const problem: unknown = await e.json();
			throw problem;
		}
		throw e;
	}
}
export async function list(
	c: Collection,
	opts: {
		page: number;
		perPage: number;
		search?: string;
		orderBy?: string;
		direction?: string;
	}
) {
	const q = new URLSearchParams();
	if (native(c.name)) {
		q.set('context', 'view');
		if (['author', 'editor', 'admin'].includes(bootstrap().role))
			q.set('status', 'publish,draft,pending,private,future');
		q.set('per_page', String(opts.perPage));
		q.set('page', String(opts.page));
		if (opts.search) q.set('search', opts.search);
		if (opts.orderBy)
			q.set('orderby', opts.orderBy === c.title ? 'title' : 'id');
		q.set('order', opts.direction ?? 'desc');
	} else {
		q.set('limit', String(opts.perPage + 1));
		q.set('offset', String((opts.page - 1) * opts.perPage));
		if (opts.search && c.title)
			q.set(
				'where',
				JSON.stringify({ [c.title]: { like: `%${opts.search}%` } })
			);
		if (opts.orderBy)
			q.set('orderBy', `${opts.direction === 'asc' ? '' : '-'}${opts.orderBy}`);
	}
	const result = await response(`${endpoint(c.name)}?${q}`);
	const payload: unknown = await result.json(),
		rows = native(c.name) ? payload : unwrap(payload);
	if (!Array.isArray(rows)) throw new Error('Expected a list from the API.');
	return {
		hasMore: rows.length > opts.perPage,
		rows: rows
			.slice(0, opts.perPage)
			.map((r: unknown) => (native(c.name) ? fromNative(c, r) : object(r))),
		total: native(c.name)
			? Number(result.headers.get('X-WP-Total'))
			: undefined,
	};
}
