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
/** Form-owned identity and provenance; never serialized into document values. */
export class EditingObjects {
	private created = new WeakSet<object>();
	private keys = new WeakMap<object, number>();
	private next = 0;
	isNew(value: object): boolean { return this.created.has(value); }
	mark(value: object): void { this.created.add(value); }
	key(value: object): number {
		let key = this.keys.get(value);
		if (key === undefined) { key = this.next++; this.keys.set(value, key); }
		return key;
	}
	replace(source: object, target: object): void {
		if (this.isNew(source)) this.mark(target);
		this.keys.set(target, this.key(source));
	}
}
export type Columns = Record<string, Column>;
export type KindUi = {
	icon?: string;
	singularLabel?: string;
	description?: string;
	group?: string;
	defaultColumns?: string[];
	hidden?: boolean;
};
export type GlobalUi = {
	icon?: string;
	description?: string;
	group?: string;
	hidden?: boolean;
};
export type Collection = {
	name: string;
	label: string;
	columns: Columns;
	primaryKey: string;
	title?: string;
	content?: string;
	slug?: string;
	/** WordPress posts' own excerpt (`wp.posts` kinds): core's `excerpt`, not a meta field. */
	excerpt?: string;
	storage?: string;
	ui?: KindUi;
	access: Row;
};
export type Schema = {
	collections: Record<string, Collection>;
	globals: Record<string, { label: string; fields: Columns; ui?: GlobalUi; access: Row }>;
};
function isRow(value: unknown): value is Row {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function object(value: unknown): Row {
	if (!isRow(value)) throw new Error('Expected an object from the API.');
	return value;
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
				d = c.default ? object(c.default) : {},
				// `.ui({ label, help })` in the app's config, as the schema describes it.
				ui = isRow(c.ui) ? c.ui : {};
			return [
				name,
				{
					type: text(c.type) ?? 'text',
					label: text(c.label) ?? text(ui.label) ?? label(name),
					help: text(c.help) ?? text(ui.help) ?? text(c.description) ?? '',
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
function parseKindUi(value: unknown): KindUi | undefined {
	if (!isRow(value)) return undefined;
	const ui: KindUi = {};
	const icon = text(value.icon);
	if (icon) ui.icon = icon;
	const singular = text(value.singularLabel);
	if (singular) ui.singularLabel = singular;
	const description = text(value.description);
	if (description) ui.description = description;
	const group = text(value.group);
	if (group) ui.group = group;
	const defaultColumns = strings(value.defaultColumns);
	if (defaultColumns.length) ui.defaultColumns = defaultColumns;
	if (value.hidden === true) ui.hidden = true;
	return Object.keys(ui).length ? ui : undefined;
}
function parseGlobalUi(value: unknown): GlobalUi | undefined {
	if (!isRow(value)) return undefined;
	const ui: GlobalUi = {};
	const icon = text(value.icon);
	if (icon) ui.icon = icon;
	const description = text(value.description);
	if (description) ui.description = description;
	const group = text(value.group);
	if (group) ui.group = group;
	if (value.hidden === true) ui.hidden = true;
	return Object.keys(ui).length ? ui : undefined;
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
						excerpt: text(c.excerpt),
						storage: text(c.storage) ?? text(c.kind),
						ui: parseKindUi(c.ui),
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
						ui: parseGlobalUi(g.ui),
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
/** Singular display label for CTA buttons ("New Doc") and form titles ("Edit Doc"). */
export function singularLabel(c: Collection): string {
	if (c.ui?.singularLabel) return c.ui.singularLabel;
	const raw = c.label.trim();
	if (!raw) return 'Record';
	const words = raw.split(/\s+/);
	const last = words[words.length - 1];
	let singular = last;
	if (/[^aeiou]ies$/i.test(last) && last.length > 3) {
		singular = last.slice(0, -3) + (last.endsWith('IES') ? 'Y' : 'y');
	} else if (/(ses|xes|zes|ches|shes)$/i.test(last) && last.length > 4) {
		singular = last.slice(0, -2);
	} else if (/s$/i.test(last) && !/(ss|us|is)$/i.test(last) && last.length > 2) {
		singular = last.slice(0, -1);
	}
	words[words.length - 1] = singular;
	return words.join(' ');
}
const HEAVY_COLUMN_TYPES = new Set([
	'richText',
	'blocks',
	'repeater',
	'group',
	'json',
	'mediaList',
	'media',
]);
/**
 * Default secondary columns for a collection's DataViews table.
 * Never includes `titleField` (DataViews already renders `titleField` as the primary column)
 * and skips raw HTML / blob columns unless explicitly selected in `ui.defaultColumns`.
 */
export function defaultListColumns(c: Collection, titleField: string): string[] {
	if (c.ui?.defaultColumns?.length) {
		return c.ui.defaultColumns.filter(
			(id) => id !== titleField && id in c.columns
		);
	}
	const candidates = Object.entries(c.columns).filter(([id, col]) => {
		if (id === titleField || id === c.primaryKey) return false;
		if (id === c.content || id === c.excerpt) return false;
		if (HEAVY_COLUMN_TYPES.has(col.type) || col.multiline) return false;
		return true;
	});
	const priority = (id: string, col: Column): number => {
		if (id === 'status') return 0;
		if (id === c.slug || id === 'slug') return 1;
		if (col.options.length > 0 || col.type === 'enum') return 2;
		if (col.type === 'boolean') return 3;
		if (col.type === 'date' || col.type === 'timestamp' || col.type === 'datetime') return 4;
		if (col.reference) return 5;
		if (col.type === 'integer' || col.type === 'number' || col.type === 'email' || col.type === 'url') return 6;
		return 7;
	};
	return candidates
		.sort(([idA, colA], [idB, colB]) => priority(idA, colA) - priority(idB, colB))
		.slice(0, 4)
		.map(([id]) => id);
}
/** Strip HTML tags and normalize whitespace for table cell previews. */
export function stripHtml(input: string): string {
	return input
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
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
