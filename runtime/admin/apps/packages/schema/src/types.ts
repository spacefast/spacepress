/**
 * The shape of `GET /zero/v1/_schema` (runtime `Schema::describe()`), as the admin reads it. Only
 * the keys the screens use are typed; the rest travels as unknown.
 */

/** A rule as the runtime summarises it: a role, `anyone`, `authenticated`, `self`, `owner`, `rule` (a function), or false (denied). */
export type AccessSummary = string | false;

export type ColumnKind =
	| 'integer'
	| 'real'
	| 'text'
	| 'boolean'
	| 'timestamp'
	| 'date'
	| 'json'
	| 'email'
	| 'url'
	| 'slug'
	| 'richText'
	| 'media'
	| 'mediaList'
	| 'file'
	| 'select'
	| 'group'
	| 'repeater'
	| 'blocks';

/** `.showIf()`: scalar siblings ANDed, with a top-level OR (config-api.md, Columns). */
export type ShowIfTest =
	| string
	| number
	| boolean
	| null
	| { eq?: unknown; ne?: unknown; in?: unknown[]; isNull?: boolean; isNotNull?: boolean };
export type ShowIfRule = { OR: Record< string, ShowIfTest >[] } | Record< string, ShowIfTest >;

export interface DescribedColumn {
	type: ColumnKind;
	primaryKey?: boolean;
	autoIncrement?: boolean;
	notNull?: boolean;
	unique?: boolean;
	/** A generated column (status, publishedAt): core's, not a field. */
	system?: boolean;
	multiline?: boolean;
	multiple?: boolean;
	enum?: string[];
	accept?: string;
	default?: { value?: unknown; now?: true; fn?: true };
	rules?: { min?: number; max?: number; pattern?: string; validate?: true };
	references?: { collection: string; column: string };
	access?: { read?: AccessSummary; create?: AccessSummary; update?: AccessSummary };
	showIf?: ShowIfRule;
	fields?: Record< string, DescribedColumn >;
	layouts?: Record< string, Record< string, DescribedColumn > >;
	localized?: boolean;
}

export interface DescribedCollection {
	/** The name under `collections` in the description: the `/zero/v1/<name>` route and the config key. */
	name: string;
	/** The schema export's key (`fieldTeams` for `field_teams`), as the typed client names it. */
	key: string;
	label: string;
	editor: boolean;
	drafts: boolean;
	revisions: boolean;
	auth: boolean;
	title: string | null;
	content: string | null;
	slug: string | null;
	primaryKey: string;
	columns: Record< string, DescribedColumn >;
	access: { read: AccessSummary; create: AccessSummary; update: AccessSummary; delete: AccessSummary };
	api: { list?: boolean; get?: boolean; create?: boolean; update?: boolean; delete?: boolean };
	/** Present for post-backed collections: the CPT and SCF naming. */
	wp: { postType: string; groupKey: string; metaPrefix: string; fieldKeyPrefix: string } | null;
	/** Present for `editor: false` collections: the table name. */
	table: string | null;
}

export interface DescribedGlobal {
	label: string;
	fields: Record< string, DescribedColumn >;
	access: { read: AccessSummary; update: AccessSummary };
}

export interface DescribedAction {
	label?: string;
	input: Record< string, DescribedColumn >;
	access: AccessSummary;
}

export interface SchemaDescription {
	name: string;
	/** Keyed by collection name; each entry's `name` repeats its key (see `withNames`). */
	collections: Record< string, DescribedCollection >;
	globals: Record< string, DescribedGlobal >;
	actions: Record< string, DescribedAction >;
	media?: unknown;
	locales?: unknown;
}

/** The roles Zero ranks, lowest first (runtime `Schema::ROLES`). */
export const ROLE_RANK: readonly string[] = [ 'guest', 'subscriber', 'author', 'editor', 'admin' ];

/** What the viewer is, as `/zero/v1/me` or the page reports it. */
export interface ViewerSummary {
	id: number | null;
	role: string | null;
}
