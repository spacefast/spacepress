export type Role = "guest" | "subscriber" | "author" | "editor" | "admin";
export interface User {
	id: number;
	name: string;
	role: Role;
}
export interface Media {
	id: number;
	url: string;
	mime: string;
	size: number;
	width: number | null;
	height: number | null;
	alt: string | null;
	filename: string;
	createdAt: string;
	sizes: Record<string, {
		url: string;
		width: number;
		height: number;
	}>;
	focal: {
		x: number;
		y: number;
	} | null;
	author: number | null;
	caption: string;
}
export interface PrivateFile {
	id: number;
	bucket: string;
	filename: string;
	mime: string;
	size: number;
	ownerId: number | null;
	createdAt: string;
	url: string;
}
export interface RevisionSummary {
	id: number;
	at: string;
	user: {
		id: number;
		name: string;
	} | null;
}
export type Status = "draft" | "published" | "scheduled";
export type Locale = never;
export interface System {
	id: number;
	name: string;
	ownerId: number;
	room: string;
	kind: "hvac" | "plumbing" | "electrical" | "appliance" | "safety";
	make: string | null;
	model: string | null;
	installedOn: string | null;
	manual: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface SystemInsert {
	name: string;
	ownerId: number;
	room: string;
	kind: "hvac" | "plumbing" | "electrical" | "appliance" | "safety";
	make?: string | null;
	model?: string | null;
	installedOn?: string | null;
	manual?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface SystemPatch {
	name?: string;
	ownerId?: number;
	room?: string;
	kind?: "hvac" | "plumbing" | "electrical" | "appliance" | "safety";
	make?: string | null;
	model?: string | null;
	installedOn?: string | null;
	manual?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface SystemWith {
	tasks?: true | {
		where?: TaskFilter;
		orderBy?: TaskOrder;
		limit?: number;
		offset?: number;
		with?: TaskWith;
	};
	doneLogs?: true | {
		where?: DoneLogFilter;
		orderBy?: DoneLogOrder;
		limit?: number;
		offset?: number;
		with?: DoneLogWith;
	};
	manual?: true;
}
export interface SystemFilter {
	id?: number | null | {
		eq?: number | null;
		ne?: number | null;
		gt?: number;
		gte?: number;
		lt?: number;
		lte?: number;
		in?: number[];
		notIn?: number[];
		isNull?: true;
		isNotNull?: true;
	};
	name?: string | null | {
		eq?: string | null;
		ne?: string | null;
		gt?: string;
		gte?: string;
		lt?: string;
		lte?: string;
		in?: string[];
		notIn?: string[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	ownerId?: number | null | {
		eq?: number | null;
		ne?: number | null;
		gt?: number;
		gte?: number;
		lt?: number;
		lte?: number;
		in?: number[];
		notIn?: number[];
		isNull?: true;
		isNotNull?: true;
	};
	room?: string | null | {
		eq?: string | null;
		ne?: string | null;
		gt?: string;
		gte?: string;
		lt?: string;
		lte?: string;
		in?: string[];
		notIn?: string[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	kind?: "hvac" | "plumbing" | "electrical" | "appliance" | "safety" | null | {
		eq?: "hvac" | "plumbing" | "electrical" | "appliance" | "safety" | null;
		ne?: "hvac" | "plumbing" | "electrical" | "appliance" | "safety" | null;
		gt?: "hvac" | "plumbing" | "electrical" | "appliance" | "safety";
		gte?: "hvac" | "plumbing" | "electrical" | "appliance" | "safety";
		lt?: "hvac" | "plumbing" | "electrical" | "appliance" | "safety";
		lte?: "hvac" | "plumbing" | "electrical" | "appliance" | "safety";
		in?: ("hvac" | "plumbing" | "electrical" | "appliance" | "safety")[];
		notIn?: ("hvac" | "plumbing" | "electrical" | "appliance" | "safety")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	make?: string | null | {
		eq?: string | null;
		ne?: string | null;
		gt?: string;
		gte?: string;
		lt?: string;
		lte?: string;
		in?: string[];
		notIn?: string[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	model?: string | null | {
		eq?: string | null;
		ne?: string | null;
		gt?: string;
		gte?: string;
		lt?: string;
		lte?: string;
		in?: string[];
		notIn?: string[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	installedOn?: string | null | {
		eq?: string | null;
		ne?: string | null;
		gt?: string;
		gte?: string;
		lt?: string;
		lte?: string;
		in?: string[];
		notIn?: string[];
		isNull?: true;
		isNotNull?: true;
	};
	manual?: number | null | {
		eq?: number | null;
		ne?: number | null;
		gt?: number;
		gte?: number;
		lt?: number;
		lte?: number;
		in?: number[];
		notIn?: number[];
		isNull?: true;
		isNotNull?: true;
	};
	status?: "draft" | "published" | "scheduled" | null | {
		eq?: "draft" | "published" | "scheduled" | null;
		ne?: "draft" | "published" | "scheduled" | null;
		gt?: "draft" | "published" | "scheduled";
		gte?: "draft" | "published" | "scheduled";
		lt?: "draft" | "published" | "scheduled";
		lte?: "draft" | "published" | "scheduled";
		in?: ("draft" | "published" | "scheduled")[];
		notIn?: ("draft" | "published" | "scheduled")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	publishedAt?: string | null | {
		eq?: string | null;
		ne?: string | null;
		gt?: string;
		gte?: string;
		lt?: string;
		lte?: string;
		in?: string[];
		notIn?: string[];
		isNull?: true;
		isNotNull?: true;
	};
	tasks?: true | TaskFilter;
	doneLogs?: true | DoneLogFilter;
	AND?: SystemFilter[];
	OR?: SystemFilter[];
	NOT?: SystemFilter;
}
export type SystemOrder = Partial<Record<"id" | "name" | "ownerId" | "room" | "kind" | "make" | "model" | "installedOn" | "manual" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface Task {
	id: number;
	title: string;
	ownerId: number;
	systemId: number;
	everyDays: number;
	lastDoneOn: string | null;
	nextDueOn: string;
	instructions: string | null;
	overdueAt: string | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface TaskInsert {
	title: string;
	ownerId: number;
	systemId: number;
	everyDays?: number;
	lastDoneOn?: string | null;
	nextDueOn?: string;
	instructions?: string | null;
	overdueAt?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface TaskPatch {
	title?: string;
	ownerId?: number;
	systemId?: number;
	everyDays?: number;
	lastDoneOn?: string | null;
	nextDueOn?: string;
	instructions?: string | null;
	overdueAt?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface TaskWith {
	systemId?: true | {
		where?: SystemFilter;
		orderBy?: SystemOrder;
		limit?: number;
		offset?: number;
		with?: SystemWith;
	};
	doneLogs?: true | {
		where?: DoneLogFilter;
		orderBy?: DoneLogOrder;
		limit?: number;
		offset?: number;
		with?: DoneLogWith;
	};
}
export interface TaskFilter {
	id?: number | null | {
		eq?: number | null;
		ne?: number | null;
		gt?: number;
		gte?: number;
		lt?: number;
		lte?: number;
		in?: number[];
		notIn?: number[];
		isNull?: true;
		isNotNull?: true;
	};
	title?: string | null | {
		eq?: string | null;
		ne?: string | null;
		gt?: string;
		gte?: string;
		lt?: string;
		lte?: string;
		in?: string[];
		notIn?: string[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	ownerId?: number | null | {
		eq?: number | null;
		ne?: number | null;
		gt?: number;
		gte?: number;
		lt?: number;
		lte?: number;
		in?: number[];
		notIn?: number[];
		isNull?: true;
		isNotNull?: true;
	};
	systemId?: number | null | {
		eq?: number | null;
		ne?: number | null;
		gt?: number;
		gte?: number;
		lt?: number;
		lte?: number;
		in?: number[];
		notIn?: number[];
		isNull?: true;
		isNotNull?: true;
	} | SystemFilter;
	everyDays?: number | null | {
		eq?: number | null;
		ne?: number | null;
		gt?: number;
		gte?: number;
		lt?: number;
		lte?: number;
		in?: number[];
		notIn?: number[];
		isNull?: true;
		isNotNull?: true;
	};
	lastDoneOn?: string | null | {
		eq?: string | null;
		ne?: string | null;
		gt?: string;
		gte?: string;
		lt?: string;
		lte?: string;
		in?: string[];
		notIn?: string[];
		isNull?: true;
		isNotNull?: true;
	};
	nextDueOn?: string | null | {
		eq?: string | null;
		ne?: string | null;
		gt?: string;
		gte?: string;
		lt?: string;
		lte?: string;
		in?: string[];
		notIn?: string[];
		isNull?: true;
		isNotNull?: true;
	};
	instructions?: string | null | {
		eq?: string | null;
		ne?: string | null;
		gt?: string;
		gte?: string;
		lt?: string;
		lte?: string;
		in?: string[];
		notIn?: string[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	overdueAt?: string | null | {
		eq?: string | null;
		ne?: string | null;
		gt?: string;
		gte?: string;
		lt?: string;
		lte?: string;
		in?: string[];
		notIn?: string[];
		isNull?: true;
		isNotNull?: true;
	};
	status?: "draft" | "published" | "scheduled" | null | {
		eq?: "draft" | "published" | "scheduled" | null;
		ne?: "draft" | "published" | "scheduled" | null;
		gt?: "draft" | "published" | "scheduled";
		gte?: "draft" | "published" | "scheduled";
		lt?: "draft" | "published" | "scheduled";
		lte?: "draft" | "published" | "scheduled";
		in?: ("draft" | "published" | "scheduled")[];
		notIn?: ("draft" | "published" | "scheduled")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	publishedAt?: string | null | {
		eq?: string | null;
		ne?: string | null;
		gt?: string;
		gte?: string;
		lt?: string;
		lte?: string;
		in?: string[];
		notIn?: string[];
		isNull?: true;
		isNotNull?: true;
	};
	doneLogs?: true | DoneLogFilter;
	AND?: TaskFilter[];
	OR?: TaskFilter[];
	NOT?: TaskFilter;
}
export type TaskOrder = Partial<Record<"id" | "title" | "ownerId" | "systemId" | "everyDays" | "lastDoneOn" | "nextDueOn" | "instructions" | "overdueAt" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface DoneLog {
	id: number;
	title: string;
	ownerId: number;
	taskId: number;
	systemId: number;
	doneOn: string;
	notes: string | null;
	costCents: number;
	photo: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface DoneLogInsert {
	title?: string;
	ownerId: number;
	taskId: number;
	systemId: number;
	doneOn?: string;
	notes?: string | null;
	costCents?: number;
	photo?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface DoneLogPatch {
	title?: string;
	ownerId?: number;
	taskId?: number;
	systemId?: number;
	doneOn?: string;
	notes?: string | null;
	costCents?: number;
	photo?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface DoneLogWith {
	taskId?: true | {
		where?: TaskFilter;
		orderBy?: TaskOrder;
		limit?: number;
		offset?: number;
		with?: TaskWith;
	};
	systemId?: true | {
		where?: SystemFilter;
		orderBy?: SystemOrder;
		limit?: number;
		offset?: number;
		with?: SystemWith;
	};
	photo?: true;
}
export interface DoneLogFilter {
	id?: number | null | {
		eq?: number | null;
		ne?: number | null;
		gt?: number;
		gte?: number;
		lt?: number;
		lte?: number;
		in?: number[];
		notIn?: number[];
		isNull?: true;
		isNotNull?: true;
	};
	title?: string | null | {
		eq?: string | null;
		ne?: string | null;
		gt?: string;
		gte?: string;
		lt?: string;
		lte?: string;
		in?: string[];
		notIn?: string[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	ownerId?: number | null | {
		eq?: number | null;
		ne?: number | null;
		gt?: number;
		gte?: number;
		lt?: number;
		lte?: number;
		in?: number[];
		notIn?: number[];
		isNull?: true;
		isNotNull?: true;
	};
	taskId?: number | null | {
		eq?: number | null;
		ne?: number | null;
		gt?: number;
		gte?: number;
		lt?: number;
		lte?: number;
		in?: number[];
		notIn?: number[];
		isNull?: true;
		isNotNull?: true;
	} | TaskFilter;
	systemId?: number | null | {
		eq?: number | null;
		ne?: number | null;
		gt?: number;
		gte?: number;
		lt?: number;
		lte?: number;
		in?: number[];
		notIn?: number[];
		isNull?: true;
		isNotNull?: true;
	} | SystemFilter;
	doneOn?: string | null | {
		eq?: string | null;
		ne?: string | null;
		gt?: string;
		gte?: string;
		lt?: string;
		lte?: string;
		in?: string[];
		notIn?: string[];
		isNull?: true;
		isNotNull?: true;
	};
	notes?: string | null | {
		eq?: string | null;
		ne?: string | null;
		gt?: string;
		gte?: string;
		lt?: string;
		lte?: string;
		in?: string[];
		notIn?: string[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	costCents?: number | null | {
		eq?: number | null;
		ne?: number | null;
		gt?: number;
		gte?: number;
		lt?: number;
		lte?: number;
		in?: number[];
		notIn?: number[];
		isNull?: true;
		isNotNull?: true;
	};
	photo?: number | null | {
		eq?: number | null;
		ne?: number | null;
		gt?: number;
		gte?: number;
		lt?: number;
		lte?: number;
		in?: number[];
		notIn?: number[];
		isNull?: true;
		isNotNull?: true;
	};
	status?: "draft" | "published" | "scheduled" | null | {
		eq?: "draft" | "published" | "scheduled" | null;
		ne?: "draft" | "published" | "scheduled" | null;
		gt?: "draft" | "published" | "scheduled";
		gte?: "draft" | "published" | "scheduled";
		lt?: "draft" | "published" | "scheduled";
		lte?: "draft" | "published" | "scheduled";
		in?: ("draft" | "published" | "scheduled")[];
		notIn?: ("draft" | "published" | "scheduled")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	publishedAt?: string | null | {
		eq?: string | null;
		ne?: string | null;
		gt?: string;
		gte?: string;
		lt?: string;
		lte?: string;
		in?: string[];
		notIn?: string[];
		isNull?: true;
		isNotNull?: true;
	};
	AND?: DoneLogFilter[];
	OR?: DoneLogFilter[];
	NOT?: DoneLogFilter;
}
export type DoneLogOrder = Partial<Record<"id" | "title" | "ownerId" | "taskId" | "systemId" | "doneOn" | "notes" | "costCents" | "photo" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface DueNextInput {
	days?: number;
}
export type DueNextOutput = {
	through: string;
	tasks: Task[];
};
export interface MarkDoneInput {
	taskId: number;
	notes?: string | null;
	costCents?: number | null;
}
export type MarkDoneOutput = {
	log?: DoneLog;
	task?: Task;
};
export interface YearCostInput {
	year: number;
}
export type YearCostOutput = {
	year: number;
	systems: ({
		systemId: number;
		name: string;
		costCents: number;
	})[];
	totalCents: number;
};
export interface Collections {
	systems: {
		row: System;
		insert: SystemInsert;
		patch: SystemPatch;
		with: SystemWith;
		filter: SystemFilter;
		order: SystemOrder;
	};
	tasks: {
		row: Task;
		insert: TaskInsert;
		patch: TaskPatch;
		with: TaskWith;
		filter: TaskFilter;
		order: TaskOrder;
	};
	doneLogs: {
		row: DoneLog;
		insert: DoneLogInsert;
		patch: DoneLogPatch;
		with: DoneLogWith;
		filter: DoneLogFilter;
		order: DoneLogOrder;
	};
}
export interface Globals {}
export interface Actions {
	dueNext: {
		input: DueNextInput;
		output: DueNextOutput;
	};
	markDone: {
		input: MarkDoneInput;
		output: MarkDoneOutput;
	};
	yearCost: {
		input: YearCostInput;
		output: YearCostOutput;
	};
}
export declare const SCHEMA: {
	readonly name: "home-maintenance";
	readonly collections: {
		readonly systems: {
			readonly path: "systems";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly tasks: {
					readonly kind: "many";
					readonly collection: "tasks";
					readonly optional: false;
				};
				readonly doneLogs: {
					readonly kind: "many";
					readonly collection: "doneLogs";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly ["manual"];
		};
		readonly tasks: {
			readonly path: "tasks";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly systemId: {
					readonly kind: "one";
					readonly collection: "systems";
					readonly optional: false;
				};
				readonly doneLogs: {
					readonly kind: "many";
					readonly collection: "doneLogs";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly doneLogs: {
			readonly path: "done_logs";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly taskId: {
					readonly kind: "one";
					readonly collection: "tasks";
					readonly optional: false;
				};
				readonly systemId: {
					readonly kind: "one";
					readonly collection: "systems";
					readonly optional: false;
				};
			};
			readonly media: readonly ["photo"];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
	};
	readonly globals: readonly [];
	readonly actions: readonly ["dueNext", "markDone", "yearCost"];
	readonly buckets: readonly ["manuals"];
};
export type SchemaDescriptor = typeof SCHEMA;
type Descriptor = typeof SCHEMA;
type CollectionDescriptors = Descriptor["collections"];
/** Schema keys of every collection (`client.<key>`). */
export type CollectionKey = keyof Collections & keyof CollectionDescriptors & string;
type Row<K extends CollectionKey> = Collections[K]["row"];
type Rels<K extends CollectionKey> = CollectionDescriptors[K]["relations"];
type IdOf<K extends CollectionKey> = Row<K>[CollectionDescriptors[K]["primaryKey"] & keyof Row<K>];
/** `with` keys that load something (`false`/`undefined` entries load nothing). */
type Requested<W> = { [P in keyof W]-?: W[P] extends false | undefined | null ? never : P }[keyof W];
type NestedWith<V> = V extends {
	with: infer W;
} ? W : {};
type RelationValue<
	R,
	V
> = R extends {
	kind: "one";
	collection: infer T extends CollectionKey;
	optional: infer O;
} ? RowWith<T, NestedWith<V>> | (O extends false ? never : null) : R extends {
	kind: "many";
	collection: infer T extends CollectionKey;
} ? RowWith<T, NestedWith<V>>[] : never;
type WithValue<
	K extends CollectionKey,
	P,
	V
> = P extends keyof Rels<K> ? RelationValue<Rels<K>[P], V> : P extends CollectionDescriptors[K]["mediaList"][number] ? Media[] | (null extends Row<K>[P & keyof Row<K>] ? null : never) : P extends CollectionDescriptors[K]["media"][number] ? Media | null : P extends CollectionDescriptors[K]["files"][number] ? PrivateFile | number | (null extends Row<K>[P & keyof Row<K>] ? null : never) : never;
/**
* A row of collection `K` loaded with `with: W`: `one` relations become the related row (or null when
* optional), `many` relations a list, and requested media columns are replaced in place by media rows.
* Requested file columns become the file row when the bucket's read rule admits the viewer, else stay the id.
*/
export type RowWith<
	K extends CollectionKey,
	W
> = [Requested<W>] extends [never] ? Row<K> : ([Requested<W> & keyof Row<K>] extends [never] ? Row<K> : Omit<Row<K>, Requested<W> & keyof Row<K>>) & { -readonly [P in Exclude<Requested<W>, OptionalKeys<Row<K>>>]: WithValue<K, P, W[P]> } & { -readonly [P in Extract<Requested<W>, OptionalKeys<Row<K>>>]?: WithValue<K, P, W[P]> };
type OptionalKeys<T> = { [P in keyof T]-?: {} extends Pick<T, P> ? P : never }[keyof T] & PropertyKey;
/** Rejects `with` keys that are neither relations nor media columns (`with: { autor: true }`). */
type ExactWith<
	K extends CollectionKey,
	W
> = W & { [P in Exclude<keyof W, keyof Collections[K]["with"]>]: never };
type StatusQuery<K extends CollectionKey> = CollectionDescriptors[K]["drafts"] extends true ? {
	/** Shorthand for `where: { status }` (ANDed with `where`). */ status?: Status;
} : {};
type LocaleQuery<K extends CollectionKey> = CollectionDescriptors[K]["localized"] extends true ? {
	/** Rows in this locale, falling back to the default locale per translation group; `"*"` = every row. Default: the default locale. */ locale?: Locale | "*";
} : {};
export type ListQuery<
	K extends CollectionKey,
	W = Collections[K]["with"]
> = {
	where?: Collections[K]["filter"];
	/** `{ createdAt: "desc", title: "asc" }` or the wire form `"-createdAt,title"`. */
	orderBy?: Collections[K]["order"];
	limit?: number;
	offset?: number;
	with?: W;
} & StatusQuery<K> & LocaleQuery<K>;
export interface CollectionClient<K extends CollectionKey> {
	list<const W extends Collections[K]["with"] = Extract<{}, Collections[K]["with"]>>(q?: ListQuery<K, ExactWith<K, W>>): Promise<RowWith<K, W>[]>;
	/** One page and the `cursor` of the next (null on the last page): pass it back as `cursor`. */
	paginate<const W extends Collections[K]["with"] = Extract<{}, Collections[K]["with"]>>(q?: ListQuery<K, ExactWith<K, W>> & {
		cursor?: string | null;
	}): Promise<{
		rows: RowWith<K, W>[];
		cursor: string | null;
	}>;
	/** With `locale`, the row of `id`'s translation group in that locale (or its fallback). */
	get<const W extends Collections[K]["with"] = Extract<{}, Collections[K]["with"]>>(id: IdOf<K>, q?: {
		with?: ExactWith<K, W>;
	} & LocaleQuery<K>): Promise<RowWith<K, W>>;
	create(data: Collections[K]["insert"]): Promise<Row<K>>;
	update(id: IdOf<K>, patch: Collections[K]["patch"]): Promise<Row<K>>;
	delete(id: IdOf<K>): Promise<Row<K>>;
	/**
	* Runs `list(q)` now and again whenever this collection (or a collection loaded through `with`)
	* changes. Every refresh is the normal access-checked read; change notices carry no rows.
	* Returns a function that stops watching.
	*/
	watch<const W extends Collections[K]["with"] = Extract<{}, Collections[K]["with"]>>(q: ListQuery<K, ExactWith<K, W>> | undefined, onRows: (rows: RowWith<K, W>[]) => void, onError?: (error: FirstError) => void): () => void;
	revisions: {
		/** Newest first. Needs `update` access on the row. */
		list(id: IdOf<K>): Promise<RevisionSummary[]>;
		get(id: IdOf<K>, revisionId: number): Promise<Row<K>>;
		/** Runs the update pipeline with the revision as the patch; returns the updated row. */
		restore(id: IdOf<K>, revisionId: number): Promise<Row<K>>;
	};
	/**
	* Save `patch` as the item's staged version: the live row stays as it is until `promote`. One
	* staged version per item, shared by everyone who may update it; each call adds to it. Post
	* kinds only. Every staged call needs `update` access on the row, and answers 404 without it.
	*/
	stage(id: IdOf<K>, patch: Collections[K]["patch"]): Promise<StagedVersion<K>>;
	/** The staged version: the row as it would be once promoted. 404 when nothing is staged. */
	staged(id: IdOf<K>): Promise<StagedVersion<K>>;
	/** The staged fields whose value differs from the live row, with both values. */
	compare(id: IdOf<K>): Promise<StagedComparison<K>>;
	/**
	* Make the staged version live, as an update of the row by the caller. With `at` (a future ISO
	* time) the promote is scheduled instead, and `at: null` cancels a scheduled one; both return
	* the staged version.
	*/
	promote(id: IdOf<K>): Promise<Row<K>>;
	promote(id: IdOf<K>, options: {
		at: string | null;
	}): Promise<StagedVersion<K>>;
	/** End the staged version. It stays in the row's revisions, as `revision`. */
	discard(id: IdOf<K>): Promise<{
		revision: number;
	}>;
	/** A signed link to the staged version that works without signing in for `ttl` seconds (an hour by default). */
	previewLink(id: IdOf<K>, options?: {
		ttl?: number;
	}): Promise<StagedPreview>;
}
/** A staged version: the row once promoted, the fields that are staged, who staged last. */
export interface StagedVersion<K extends CollectionKey> {
	/** The revision holding it. */
	id: number;
	row: Row<K>;
	fields: (keyof Row<K> & string)[];
	by: {
		id: number;
		name: string;
	} | null;
	at: string;
	/** When a scheduled promote runs, or null. */
	promoteAt: string | null;
	/** Why the last scheduled promote did not run. */
	error?: {
		code: string;
		detail: string;
		at: string;
	};
}
export interface StagedComparison<K extends CollectionKey> extends Omit<StagedVersion<K>, "row" | "fields"> {
	changes: { [F in keyof Row<K> & string]: {
		field: F;
		live: Row<K>[F];
		staged: Row<K>[F];
	} }[keyof Row<K> & string][];
}
export interface StagedPreview {
	token: string;
	expiresAt: string;
	/** Reads the staged version without signing in. */
	api: string;
	/** The item's own page showing the staged version, when the kind has a public URL. */
	url: string | null;
}
export interface MediaQuery {
	where?: Record<string, unknown>;
	orderBy?: Record<string, "asc" | "desc"> | string;
	limit?: number;
	offset?: number;
}
export interface MediaClient {
	list(q?: MediaQuery): Promise<Media[]>;
	get(id: number): Promise<Media>;
	/** `multipart/form-data` with fields `file` and `alt`. */
	upload(file: Blob, opts?: {
		alt?: string;
		filename?: string;
	}): Promise<Media>;
	/** Editors only. A new `focal` point (0..1 from the top-left) regenerates every `cover` size. */
	update(id: number, patch: {
		alt?: string | null;
		focal?: {
			x: number;
			y: number;
		} | null;
	}): Promise<Media>;
	delete(id: number): Promise<Media>;
}
export interface FileBucketClient {
	/** `multipart/form-data` field `file`; the bucket's `accept`, `maxBytes` and `create` rule apply. */
	upload(file: Blob, opts?: {
		filename?: string;
	}): Promise<PrivateFile>;
	/** The row with a fresh `url`: a signed download link valid for 5 minutes. */
	get(id: number): Promise<PrivateFile>;
	delete(id: number): Promise<PrivateFile>;
}
export type FilesClient = { readonly [B in Descriptor["buckets"][number]]: FileBucketClient };
export type ActionsClient = { [A in keyof Actions]: {} extends Actions[A]["input"] ? (input?: Actions[A]["input"]) => Promise<Actions[A]["output"]> : (input: Actions[A]["input"]) => Promise<Actions[A]["output"]> };
export type GlobalsClient = { [G in keyof Globals]: {
	get(): Promise<Globals[G]["row"]>;
	update(patch: Globals[G]["patch"]): Promise<Globals[G]["row"]>;
} };
/** The tokens a signed-in client holds (`auth.session()`). */
export interface Session {
	accessToken: string;
	refreshToken: string;
	/** Epoch milliseconds. */
	expiresAt: number;
}
export interface AuthClient {
	/** Redirects to `<issuer>/authorize` (PKCE S256); the promise never settles. */
	signIn(opts?: {
		returnTo?: string;
	}): Promise<never>;
	/** On the redirect URI: exchanges `?code` at `<issuer>/token`, keeps the tokens, returns the user. */
	handleCallback(): Promise<User>;
	/** Starts a guest session (`role: "guest"`) and keeps its tokens. */
	guest(): Promise<User>;
	/** Sends the current guest to the issuer's screens to upgrade in place; never settles. */
	upgrade(): Promise<never>;
	/** The signed-in user (with `member`, the auth collection row, when the app has one), or null. */
	me(): Promise<User | null>;
	/** Revokes the session and forgets the tokens; also signs out at the issuer when `returnTo` is given. */
	signOut(opts?: {
		returnTo?: string;
	}): Promise<void>;
	/** The held tokens, for server-side callers that forward them; null when signed out. */
	session(): Session | null;
}
export type Client = { readonly [K in CollectionKey]: CollectionClient<K> } & {
	readonly media: MediaClient;
	readonly files: FilesClient;
	readonly actions: ActionsClient;
	readonly globals: GlobalsClient;
	readonly auth: AuthClient;
	/** `GET /__first/api/v1`: the app's schema (kinds, fields, globals, actions), as `first pull` reads it. */
	schema(): Promise<unknown>;
};
/** One committed transaction's changes, as the runtime's `first_realtime_changes` hook sends them. */
export interface ChangeNotice {
	id: string;
	at: string;
	/** `ids: null` means "some rows changed": too many to list, or ids withheld from a shared room. */
	changes: {
		collection: string;
		ops: ("create" | "update" | "delete")[];
		ids: (string | number)[] | null;
	}[];
}
/**
* Delivers change notices from the host (Cast, a WebSocket relay, Pusher, ...). First ships none.
* `connect` starts delivery and returns a stop function; call `status("live")` once notices flow
* and `status("down")` when they stop, so the client polls meanwhile.
*/
export interface RealtimeTransport {
	connect(deliver: (notice: ChangeNotice) => void, status: (state: "live" | "down") => void): () => void;
}
export interface RealtimeOptions {
	/** The transport. Default: the one a host registered with `registerRealtimeTransport`; `false` = polling only. */
	transport?: RealtimeTransport | false;
	/** Refresh watched reads this often while no transport is live. Default 30000; `false` turns polling off. */
	pollMs?: number | false;
	/**
	* A slow safety refresh while the transport is live, covering a notice the transport lost.
	* Default 60000 with up to ±20% jitter per refresh; `false` turns it off.
	*/
	livePollMs?: number | false;
}
/** For host scripts: every client on this page, created before or after, uses this transport by default. */
export declare function registerRealtimeTransport(transport: RealtimeTransport): void;
export interface ClientOptions {
	/** Base URL including the API prefix: "https://x.test/__first/api/v1". Default: `/__first/api/v1` on the page's origin. */
	url?: string;
	/** WordPress cookie auth: the REST nonce; sent as `X-WP-Nonce` with `credentials: "same-origin"`. */
	nonce?: string;
	fetch?: typeof fetch;
	/** Extra headers on every request (e.g. `Authorization: Basic ...` for application passwords). They win over the above. */
	headers?: Record<string, string>;
	/** Frontend sign-in (design §6.2). */
	auth?: AuthOptions;
	/** Live updates for `watch`. */
	realtime?: RealtimeOptions;
}
export interface AuthOptions {
	/** The first-identity OIDC issuer (`https://x.test/identity`). Default: `issuer` from `GET /auth/config`. */
	issuer?: string;
	/** The registered application's client id. */
	clientId?: string;
	/** Where the issuer sends the browser back (the page that calls `handleCallback()`). */
	redirectUri?: string;
	/** Where tokens live: in memory (default) or `sessionStorage` under `first.auth:<base url>`. */
	storage?: "memory" | "session";
	/** A write rejected as unauthenticated while signed out starts a guest session and is retried once. */
	guests?: boolean;
}
/** RFC 9457 problem document, as the runtime sends it. */
export interface Problem {
	type: string;
	title: string;
	status: number;
	code: string;
	detail: string;
	pointer?: string;
}
/** Thrown for every non-2xx response; the fields are the problem document. Network failures: status 0, code "network". */
export declare class FirstError extends Error {
	readonly status: number;
	readonly code: string;
	readonly detail: string;
	readonly title: string;
	readonly type: string;
	readonly pointer?: string;
	constructor(problem: Problem);
}
export declare function createClient(options?: ClientOptions): Client;
/**
* Runs `read` now and again whenever one of `collections` (schema keys) changes, while `client`'s
* transport is live, or on its polling interval otherwise. For reads `watch` on a collection can't
* express: an action's result, a `get`, a global. Returns a function that stops watching.
*/
export declare function watch<T>(client: Client, collections: readonly CollectionKey[], read: () => Promise<T>, onResult: (value: T) => void, onError?: (error: FirstError) => void): () => void;
export {};
