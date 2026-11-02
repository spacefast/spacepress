/** Public metadata is presentation, never authorization. */
export type Row = Record<string, unknown>;
export type Column = {
	type: string;
	label: string;
	help: string;
	required: boolean;
	generated: boolean;
	multiple: boolean;
	multiline: boolean;
	options: string[];
	fields: Columns;
	layouts: Record<string, Columns>;
	reference?: { collection: string; column: string };
	bucket?: string;
	showIf?: Row;
	read?: string | boolean;
	create?: string | boolean;
	write?: string | boolean;
	initial?: unknown;
};
export type Columns = Record<string, Column>;
export type Collection = {
	name: string;
	label: string;
	columns: Columns;
	primaryKey: string;
	title?: string;
	content?: string;
	slug?: string;
	storage?: string;
	access: Row;
};
export type Schema = {
	collections: Record<string, Collection>;
	globals: Record<string, { label: string; fields: Columns; access: Row }>;
};
export function object(value: unknown): Row {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Expected an object from the API.');
	return Object.fromEntries(Object.entries(value));
}
export function map(value: unknown): Row {
	return Array.isArray(value) && value.length === 0 ? {} : object(value);
}
export function text(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}
export function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((v): v is string => typeof v === 'string')
		: [];
}
function summary(value: unknown): string | boolean | undefined {
	return typeof value === 'string' || typeof value === 'boolean'
		? value
		: undefined;
}
function reference(value: unknown): Column['reference'] {
	if (value == null) return undefined;
	const r = object(value),
		collection = text(r.collection),
		column = text(r.column);
	if (!collection || !column)
		throw new Error('Missing referenced collection or column.');
	return { collection, column };
}
export function columns(value: unknown): Columns {
	return Object.fromEntries(
		Object.entries(map(value)).map(([name, raw]) => {
			const c = object(raw),
				access = c.access ? object(c.access) : {},
				d = c.default ? object(c.default) : {};
			return [
				name,
				{
					type: text(c.type) ?? 'text',
					label: text(c.label) ?? label(name),
					help: text(c.help) ?? text(c.description) ?? '',
					required:
						c.notNull === true &&
						c.default === undefined &&
						c.autoIncrement !== true,
					generated:
						c.autoIncrement === true ||
						c.onUpdate !== undefined ||
						d.now === true ||
						d.fn !== undefined,
					multiple: c.multiple === true,
					multiline: c.multiline === true,
					options: strings(c.enum),
					fields: c.fields ? columns(c.fields) : {},
					layouts: c.layouts
						? Object.fromEntries(
								Object.entries(object(c.layouts)).map(([k, f]) => [
									k,
									columns(f),
								])
							)
						: {},
					bucket: text(c.bucket),
					reference: reference(c.references),
					showIf: c.showIf ? object(c.showIf) : undefined,
					read: summary(access.read),
					create: summary(access.create),
					write: summary(access.update),
					initial: d.value,
				},
			];
		})
	);
}
export function parseSchema(value: unknown): Schema {
	const s = object(value);
	return {
		collections: Object.fromEntries(
			Object.entries(map(s.collections)).map(([name, value]) => {
				const c = object(value);
				return [
					name,
					{
						name,
						label: text(c.label) ?? label(name),
						columns: columns(c.columns),
						primaryKey: text(c.primaryKey) ?? 'id',
						title: text(c.title),
						content: text(c.content),
						slug: text(c.slug),
						storage: text(c.storage) ?? text(c.kind),
						access: map(c.access),
					},
				];
			})
		),
		globals: Object.fromEntries(
			Object.entries(map(s.globals)).map(([name, value]) => {
				const g = object(value);
				return [
					name,
					{
						label: text(g.label) ?? label(name),
						fields: columns(g.fields),
						access: map(g.access),
					},
				];
			})
		),
	};
}
export function label(name: string): string {
	return name
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/^./, (s) => s.toUpperCase());
}
export function allowed(rule: unknown, role: string): boolean {
	if (rule === false) return false;
	const roles = ['guest', 'subscriber', 'author', 'editor', 'admin'];
	return (
		typeof rule !== 'string' ||
		!roles.includes(rule) ||
		roles.indexOf(role) >= roles.indexOf(rule)
	);
}
export function defaults(
	fields: Columns,
	writable: (column: Column) => boolean = () => true
): Row {
	return Object.fromEntries(
		Object.entries(fields)
			.filter(([, c]) => !c.generated && c.initial !== undefined && writable(c))
			.map(([k, c]) => [k, c.initial])
	);
}
/** Declarative visibility only. Missing API fields are never synthesized on edit. */
export function visible(where: Row | undefined, values: Row): boolean {
	if (!where) return true;
	return Object.entries(where).every(([key, expected]) => {
		if ((key === 'OR' || key === 'AND') && Array.isArray(expected))
			return key === 'OR'
				? expected.some((w) => visible(object(w), values))
				: expected.every((w) => visible(object(w), values));
		const actual = values[key];
		if (expected && typeof expected === 'object' && !Array.isArray(expected))
			return Object.entries(expected).every(([op, v]) => {
				switch (op) {
					case 'eq':
						return actual === v;
					case 'ne':
						return actual !== v;
					case 'in':
						return Array.isArray(v) && v.includes(actual);
					case 'notIn':
						return Array.isArray(v) && !v.includes(actual);
					case 'isNull':
						return (actual == null) === v;
					case 'isNotNull':
						return (actual != null) === v;
					case 'gt':
						return (
							typeof actual === 'number' && typeof v === 'number' && actual > v
						);
					case 'gte':
						return (
							typeof actual === 'number' && typeof v === 'number' && actual >= v
						);
					case 'lt':
						return (
							typeof actual === 'number' && typeof v === 'number' && actual < v
						);
					case 'lte':
						return (
							typeof actual === 'number' && typeof v === 'number' && actual <= v
						);
					default:
						return false;
				}
			});
		return actual === expected;
	});
}
