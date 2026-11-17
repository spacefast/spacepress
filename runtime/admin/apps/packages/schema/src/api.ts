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
} from './model';
declare global {
	interface Window {
		tpAdmin?: unknown;
	}
}
export function bootstrap() {
	const b = object(window.tpAdmin);
	const native = Object.fromEntries(
		Object.entries(map(b.native)).map(([name, raw]) => {
			const n = object(raw),
				path = text(n.path),
				postType = text(n.postType);
			if (!path || !postType)
				throw new Error('Missing native collection transport.');
			return [
				name,
				{ path, postType, terms: Object.fromEntries(Object.entries(map(n.terms ?? {})).map(([column, value]) => {
					const key = text(value);
					if (!key) throw new Error('Missing native taxonomy field.');
					return [column, key];
				})) },
			];
		})
	);
	return {
		native,
		api: (text(b.api) ?? '/__tp/api/v1').replace(/\/+$/, ''),
		readable: strings(b.readable),
		role: text(b.role) ?? 'subscriber',
	};
}
export function native(collection: string) {
	return bootstrap().native[collection];
}
/**
 * A request to TypedPress's API (`/__tp/api/v1`, outside `/wp-json`): `url` instead of `path`, so
 * api-fetch sends the nonce and the cookie and parses problems as for any core route.
 */
export function api(path: string): { url: string } {
	return { url: bootstrap().api + path };
}
/** An api-fetch target for a collection: its core route when it has one, else TypedPress's API. */
export function target(collection: string, suffix = ''): { path: string } | { url: string } {
	const n = native(collection);
	return n ? { path: n.path + suffix } : api(`/${encodeURIComponent(collection)}${suffix}`);
}
export function unwrap(value: unknown): unknown {
	const r = object(value);
	return 'data' in r ? r.data : r;
}
export async function schema() {
	const described = object(unwrap(await apiFetch(api(''))));
	// The facade lists kinds; the admin's model reads them as collections (those TypedPress stores).
	const kinds = map(described.kinds);
	return parseSchema({ ...described, collections: Object.fromEntries(Object.entries(kinds).filter(([, k]) => ['post', 'users', 'table'].includes(String(object(k).type)))) });
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
export function collectionForPostType(postType: string): string {
	return (
		Object.entries(bootstrap().native).find(
			([, n]) => n.postType === postType
		)?.[0] ?? postType
	);
}
/** Native meta already has TypedPress's decoded field names and value shapes. */
export function fromNative(c: Collection, value: unknown): Row {
	const terms = native(c.name)?.terms ?? {};
	const r = object(value),
		result: Row = Object.fromEntries(
			Object.entries(map(r.meta ?? {})).filter(([key]) =>
				key in c.columns && !(key in terms) && key !== c.primaryKey &&
				![c.title, c.content, c.slug, c.excerpt, 'status', 'publishedAt'].includes(key)
			)
		);
	for (const [column, key] of Object.entries(terms)) {
		if (column in c.columns && key in r) result[column] = r[key];
	}
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
	core('excerpt', c.excerpt);
	core('status', 'status');
	core('date_gmt', 'publishedAt');
	if (result.status === 'publish') result.status = 'published';
	if (result.status === 'future') result.status = 'scheduled';
	return result;
}
export function toNative(c: Collection, values: Row): Row {
	const terms = native(c.name)?.terms ?? {};
	const result: Row = {},
		meta: Row = {};
	for (const [key, v] of Object.entries(values)) {
		if (key === c.primaryKey) continue;
		if (key in terms) result[terms[key]] = v;
		else if (key === c.title) result.title = v;
		else if (key === c.content) result.content = v;
		else if (key === c.slug) result.slug = v;
		else if (key === c.excerpt) result.excerpt = v;
		else if (key === 'status')
			result.status =
				v === 'published' ? 'publish' : v === 'scheduled' ? 'future' : v;
		else if (key === 'publishedAt') result.date_gmt = v;
		else
			meta[key] = v;
	}
	if (Object.keys(meta).length) result.meta = meta;
	return result;
}
export async function read(c: Collection, id: string): Promise<{ row: Row; editable: boolean }> {
	const one = `/${encodeURIComponent(id)}`;
	let editable = allowed(c.access.update, bootstrap().role);
	if (!native(c.name)) {
		return { row: object(unwrap(await apiFetch(target(c.name, one)))), editable };
	}
	const path = (target(c.name, one) as { path: string }).path;
	let value: unknown;
	try {
		value = await apiFetch({ path: `${path}?context=${editable ? 'edit' : 'view'}` });
	} catch (error: unknown) {
		const problem = object(error);
		const data = problem.data && typeof problem.data === 'object' ? object(problem.data) : {};
		const status = Number(problem.status ?? data.status);
		if (!editable || ![401, 403].includes(status)) throw error;
		// Function access summaries cannot establish row-level edit authority.
		// A readable record still opens, with the native editor and writes disabled.
		value = await apiFetch({ path: `${path}?context=view` });
		editable = false;
	}
	return { row: fromNative(c, value), editable };
}
/** Gutenberg writes core fields; use a partial form when one is masked or read-only. */
export function nativeEditor(c: Collection, row: Row, editable: boolean): boolean {
	const role = bootstrap().role;
	const writable = (rule: unknown) =>
		(rule === undefined || rule === true || rule === 'anyone' ||
			['guest', 'subscriber', 'author', 'editor', 'admin'].includes(String(rule))) &&
		allowed(rule, role);
	return Boolean(native(c.name) && c.content && editable &&
		[c.content, c.title, c.slug, 'status', 'publishedAt'].every((key) =>
			!key || !c.columns[key] || (key in row && writable(c.columns[key].write))));
}
export async function save(
	c: Collection,
	values: Row,
	id?: string
): Promise<Row> {
	const v = await apiFetch({
		...target(c.name, id ? '/' + encodeURIComponent(id) : ''),
		method: id && !native(c.name) ? 'PATCH' : 'POST',
		data: native(c.name) ? toNative(c, values) : values,
	});
	return native(c.name) ? fromNative(c, v) : object(unwrap(v));
}
/** parse:false keeps pagination headers; parse the same problem body on failures. */
export async function response(to: { path: string } | { url: string }): Promise<Response> {
	try {
		return await apiFetch({ ...to, parse: false });
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
		const statuses = c.columns.status?.options ?? [];
		if (statuses.length && allowed(c.access.update, bootstrap().role) &&
			['author', 'editor', 'admin'].includes(bootstrap().role))
			q.set('status', statuses.map((status) =>
				status === 'published' ? 'publish' : status === 'scheduled' ? 'future' : status
			).join(','));
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
	const result = await response(target(c.name, `?${q}`));
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

/** Resolve editor navigation through the active TypedPress adapter or the native WordPress routes. */
export function entityEditorPath(postType: string, postId: string): string {
    const collection = Object.entries(bootstrap().native).find(([, value]) => value.postType === postType)?.[0];
    return collection
        ? `/collections/${encodeURIComponent(collection)}/${encodeURIComponent(postId)}`
        : `/types/${encodeURIComponent(postType)}/edit/${encodeURIComponent(postId)}`;
}
