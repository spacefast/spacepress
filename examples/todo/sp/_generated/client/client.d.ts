export type Id<Kind extends string = string> = number & {
	readonly __sp_kind?: Kind;
};
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
	version: number;
	op: "create" | "update" | "delete" | "restore" | "purge";
	at: string;
	user: {
		id: number;
		name: string;
	} | null;
	schemaMigration: string | null;
	changed: string[] | null;
}
export interface RevisionDiff<T = Record<string, unknown>> {
	from: number;
	to: number;
	changes: {
		field: keyof T & string;
		from: unknown;
		to: unknown;
	}[];
}
export type Status = "draft" | "published" | "scheduled";
export type Locale = never;
export interface Task {
	id: Id<"tasks">;
	title: string;
	slug: string | null;
	notes: string | null;
	details: string | null;
	url: string | null;
	priority: "none" | "low" | "medium" | "high";
	visibility: "private" | "team";
	assigneeId: number | null;
	checklist: {
		label: string;
		done: boolean;
	}[] | null;
	bucketIds: Id<"buckets">[];
	ownerId: number;
	completedAt: string | null;
	scheduledAt: string | null;
	pendingBucket: "inbox" | "now" | "later" | "follow-up" | null;
	blockedBy: Id<"tasks"> | null;
	recurringDays: number;
	createdAt: string;
	updatedAt: string;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
	author: number | null;
	deletedAt: string | null;
	deletedBy: number | null;
	uid: string | null;
}
export interface TaskInsert {
	title: string;
	slug?: string | null;
	notes?: string | null;
	details?: string | null;
	url?: string | null;
	priority?: "none" | "low" | "medium" | "high";
	visibility?: "private" | "team";
	assigneeId?: number | null;
	checklist?: {
		label: string;
		done?: boolean;
	}[] | null;
	bucketIds?: Id<"buckets">[];
	ownerId?: number;
	completedAt?: string | null;
	scheduledAt?: string | null;
	pendingBucket?: "inbox" | "now" | "later" | "follow-up" | null;
	blockedBy?: Id<"tasks"> | null;
	recurringDays?: number;
	createdAt?: string;
	updatedAt?: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface TaskPatch {
	title?: string;
	slug?: string | null;
	notes?: string | null;
	details?: string | null;
	url?: string | null;
	priority?: "none" | "low" | "medium" | "high";
	visibility?: "private" | "team";
	assigneeId?: number | null;
	checklist?: {
		label: string;
		done?: boolean;
	}[] | null;
	bucketIds?: number[];
	ownerId?: number;
	completedAt?: string | null;
	scheduledAt?: string | null;
	pendingBucket?: "inbox" | "now" | "later" | "follow-up" | null;
	blockedBy?: number | null;
	recurringDays?: number;
	createdAt?: string;
	updatedAt?: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface TaskWith {
	bucketIds?: true | {
		where?: BucketFilter;
		orderBy?: BucketOrder;
		limit?: number;
		offset?: number;
		with?: BucketWith;
	};
	blockedBy?: true | {
		where?: TaskFilter;
		orderBy?: TaskOrder;
		limit?: number;
		offset?: number;
		with?: TaskWith;
	};
	blocking?: true | {
		where?: TaskFilter;
		orderBy?: TaskOrder;
		limit?: number;
		offset?: number;
		with?: TaskWith;
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
	slug?: string | null | {
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
	details?: string | null | {
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
	url?: string | null | {
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
	priority?: "none" | "low" | "medium" | "high" | null | {
		eq?: "none" | "low" | "medium" | "high" | null;
		ne?: "none" | "low" | "medium" | "high" | null;
		gt?: "none" | "low" | "medium" | "high";
		gte?: "none" | "low" | "medium" | "high";
		lt?: "none" | "low" | "medium" | "high";
		lte?: "none" | "low" | "medium" | "high";
		in?: ("none" | "low" | "medium" | "high")[];
		notIn?: ("none" | "low" | "medium" | "high")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	visibility?: "private" | "team" | null | {
		eq?: "private" | "team" | null;
		ne?: "private" | "team" | null;
		gt?: "private" | "team";
		gte?: "private" | "team";
		lt?: "private" | "team";
		lte?: "private" | "team";
		in?: ("private" | "team")[];
		notIn?: ("private" | "team")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	assigneeId?: number | null | {
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
	checklist?: {
		label: string;
		done: boolean;
	}[] | null | {
		eq?: {
			label: string;
			done: boolean;
		}[] | null;
		ne?: {
			label: string;
			done: boolean;
		}[] | null;
		isNull?: true;
		isNotNull?: true;
	};
	bucketIds?: [] | {
		has?: number;
		eq?: [];
		NOT?: {
			has?: number;
		};
	} | true | false | BucketFilter;
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
	completedAt?: string | null | {
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
	scheduledAt?: string | null | {
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
	pendingBucket?: "inbox" | "now" | "later" | "follow-up" | null | {
		eq?: "inbox" | "now" | "later" | "follow-up" | null;
		ne?: "inbox" | "now" | "later" | "follow-up" | null;
		gt?: "inbox" | "now" | "later" | "follow-up";
		gte?: "inbox" | "now" | "later" | "follow-up";
		lt?: "inbox" | "now" | "later" | "follow-up";
		lte?: "inbox" | "now" | "later" | "follow-up";
		in?: ("inbox" | "now" | "later" | "follow-up")[];
		notIn?: ("inbox" | "now" | "later" | "follow-up")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	blockedBy?: number | null | {
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
	recurringDays?: number | null | {
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
	createdAt?: string | null | {
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
	updatedAt?: string | null | {
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
	author?: number | null | {
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
	deletedAt?: string | null | {
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
	deletedBy?: number | null | {
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
	uid?: string | null | {
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
	blocking?: true | TaskFilter;
	AND?: TaskFilter[];
	OR?: TaskFilter[];
	NOT?: TaskFilter;
}
export type TaskOrder = Partial<Record<"id" | "title" | "slug" | "notes" | "details" | "url" | "priority" | "visibility" | "assigneeId" | "ownerId" | "completedAt" | "scheduledAt" | "pendingBucket" | "blockedBy" | "recurringDays" | "createdAt" | "updatedAt" | "status" | "publishedAt" | "author" | "deletedAt" | "deletedBy" | "uid", "asc" | "desc">> | string;
export interface Bucket {
	id: Id<"buckets">;
	name: string;
	slug: string;
	description: string;
	parent: Id<"buckets"> | null;
	count: number;
	url: string | null;
	kind: "status" | "project" | "area" | "resource";
	color: string | null;
	sortOrder: number;
	uid: string | null;
}
export interface BucketInsert {
	name: string;
	slug?: string;
	description?: string;
	parent?: Id<"buckets"> | null;
	kind?: "status" | "project" | "area" | "resource";
	color?: string | null;
	sortOrder?: number;
	uid?: string | null;
}
export interface BucketPatch {
	name?: string;
	slug?: string;
	description?: string;
	parent?: number | null;
	kind?: "status" | "project" | "area" | "resource";
	color?: string | null;
	sortOrder?: number;
	uid?: string | null;
}
export interface BucketWith {
	tasks?: true | {
		where?: TaskFilter;
		orderBy?: TaskOrder;
		limit?: number;
		offset?: number;
		with?: TaskWith;
	};
}
export interface BucketFilter {
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
	slug?: string | null | {
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
	description?: string | null | {
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
	parent?: number | null | {
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
	count?: number | null | {
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
	url?: string | null | {
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
	kind?: "status" | "project" | "area" | "resource" | null | {
		eq?: "status" | "project" | "area" | "resource" | null;
		ne?: "status" | "project" | "area" | "resource" | null;
		gt?: "status" | "project" | "area" | "resource";
		gte?: "status" | "project" | "area" | "resource";
		lt?: "status" | "project" | "area" | "resource";
		lte?: "status" | "project" | "area" | "resource";
		in?: ("status" | "project" | "area" | "resource")[];
		notIn?: ("status" | "project" | "area" | "resource")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	color?: string | null | {
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
	sortOrder?: number | null | {
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
	uid?: string | null | {
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
	tasks?: true | TaskFilter;
	AND?: BucketFilter[];
	OR?: BucketFilter[];
	NOT?: BucketFilter;
}
export type BucketOrder = Partial<Record<"id" | "name" | "slug" | "description" | "parent" | "count" | "url" | "kind" | "color" | "sortOrder" | "uid", "asc" | "desc">> | string;
export interface Settings {
	workspaceName: string;
	tagline: string;
	defaultLayout: "list" | "board";
	defaultBoardGroup: "status" | "project" | "area" | "resource" | "priority";
	showCompletedInSidebar: boolean;
}
export interface SettingsPatch {
	workspaceName?: string;
	tagline?: string;
	defaultLayout?: "list" | "board";
	defaultBoardGroup?: "status" | "project" | "area" | "resource" | "priority";
	showCompletedInSidebar?: boolean;
}
export interface CreateTaskInput {
	title: string;
	notes?: string;
	url?: string;
	priority?: string;
	visibility?: string;
	assigneeId?: string | number;
	statusBucket?: string;
	paraBucketId?: string | number;
	scheduledDate?: string;
	recurringDays?: string | number;
}
export type CreateTaskOutput = {
	id: number;
	slug: string | null;
	title: string;
};
export interface ToggleTaskInput {
	id: number | string;
}
export type ToggleTaskOutput = {
	id: number;
	completed: boolean;
	nextTaskId: number | null;
	unblockedCount: number;
} | {
	id: number;
	completed: boolean;
	nextTaskId: null;
	unblockedCount: number;
};
export interface CompleteAndStopRecurringInput {
	id: number | string;
}
export type CompleteAndStopRecurringOutput = {
	id: number;
	completed: boolean;
	unblockedCount: number;
};
export interface MoveTaskBucketInput {
	id: number | string;
	statusBucket: string;
}
export type MoveTaskBucketOutput = {
	id: number;
	statusBucket: "inbox" | "now" | "later" | "follow-up";
};
export interface MoveTaskColumnInput {
	id: number | string;
	groupBy: string;
	targetBucketId?: number | string | null;
	targetPriority?: string | null;
	complete?: boolean;
}
export type MoveTaskColumnOutput = {
	id: number;
	completed: boolean;
} | {
	id: number;
	completed: boolean;
};
export interface ToggleChecklistItemInput {
	id: number | string;
	index: number | string;
	expectedLabel?: string;
}
export type ToggleChecklistItemOutput = {
	id: number;
	checklist: ({
		label: string;
		done: boolean;
	})[];
	stale: boolean;
} | {
	id: number;
	checklist: ({
		label: string;
		done: boolean;
	})[];
	stale: boolean;
};
export interface AddChecklistItemInput {
	id: number | string;
	label: string;
}
export type AddChecklistItemOutput = {
	id: number;
	checklist: ({
		label: string;
		done: boolean;
	})[];
};
export interface RemoveChecklistItemInput {
	id: number | string;
	index: number | string;
	expectedLabel?: string;
}
export type RemoveChecklistItemOutput = {
	id: number;
	checklist: ({
		label: string;
		done: boolean;
	})[];
	stale: boolean;
} | {
	id: number;
	checklist: ({
		label: string;
		done: boolean;
	})[];
	stale: boolean;
};
export interface SnoozeTaskInput {
	id: number | string;
	days: number | string;
}
export type SnoozeTaskOutput = {
	id: number;
	scheduledAt: string;
};
export interface UpdateTaskInput {
	id: number | string;
	title: string;
	notes?: string;
	details?: string;
	url?: string;
	priority?: string;
	visibility?: string;
	assigneeId?: string | number;
	statusBucket?: string;
	paraBucketIds?: string;
	scheduledDate?: string;
	pendingBucket?: string;
	recurringDays?: string | number;
	blockedBy?: string | number;
}
export type UpdateTaskOutput = {
	id: number;
	title: string;
};
export interface DeleteTaskInput {
	id: number | string;
}
export type DeleteTaskOutput = {
	id: number;
};
export interface CreateBucketInput {
	name: string;
	kind: string;
	color?: string;
}
export type CreateBucketOutput = {
	id: number;
	slug: string;
	name: string;
};
export type OpenTasksForAdminInput = Record<string, never>;
export type OpenTasksForAdminOutput = {
	rows: Task[];
};
export type TodoMetricsInput = Record<string, never>;
export type TodoMetricsOutput = {
	now: number;
	inbox: number;
	followUp: number;
	later: number;
	scheduled: number;
	blocked: number;
	team: number;
	all: number;
	done: number;
};
export interface Collections {
	tasks: {
		row: Task;
		insert: TaskInsert;
		patch: TaskPatch;
		with: TaskWith;
		filter: TaskFilter;
		order: TaskOrder;
	};
	buckets: {
		row: Bucket;
		insert: BucketInsert;
		patch: BucketPatch;
		with: BucketWith;
		filter: BucketFilter;
		order: BucketOrder;
	};
}
export interface Globals {
	settings: {
		row: Settings;
		patch: SettingsPatch;
	};
}
export interface Actions {
	createTask: {
		input: CreateTaskInput;
		output: CreateTaskOutput;
	};
	toggleTask: {
		input: ToggleTaskInput;
		output: ToggleTaskOutput;
	};
	completeAndStopRecurring: {
		input: CompleteAndStopRecurringInput;
		output: CompleteAndStopRecurringOutput;
	};
	moveTaskBucket: {
		input: MoveTaskBucketInput;
		output: MoveTaskBucketOutput;
	};
	moveTaskColumn: {
		input: MoveTaskColumnInput;
		output: MoveTaskColumnOutput;
	};
	toggleChecklistItem: {
		input: ToggleChecklistItemInput;
		output: ToggleChecklistItemOutput;
	};
	addChecklistItem: {
		input: AddChecklistItemInput;
		output: AddChecklistItemOutput;
	};
	removeChecklistItem: {
		input: RemoveChecklistItemInput;
		output: RemoveChecklistItemOutput;
	};
	snoozeTask: {
		input: SnoozeTaskInput;
		output: SnoozeTaskOutput;
	};
	updateTask: {
		input: UpdateTaskInput;
		output: UpdateTaskOutput;
	};
	deleteTask: {
		input: DeleteTaskInput;
		output: DeleteTaskOutput;
	};
	createBucket: {
		input: CreateBucketInput;
		output: CreateBucketOutput;
	};
	openTasksForAdmin: {
		input: OpenTasksForAdminInput;
		output: OpenTasksForAdminOutput;
	};
	todoMetrics: {
		input: TodoMetricsInput;
		output: TodoMetricsOutput;
	};
}
export declare const SCHEMA: {
	readonly name: "todo";
	readonly app: "todo";
	readonly abilities: {
		readonly actions: {
			readonly createTask: {
				readonly ability: "create-task";
			};
			readonly toggleTask: {
				readonly ability: "toggle-task";
			};
			readonly completeAndStopRecurring: {
				readonly ability: "complete-and-stop-recurring";
			};
			readonly moveTaskBucket: {
				readonly ability: "move-task-bucket";
			};
			readonly moveTaskColumn: {
				readonly ability: "move-task-column";
			};
			readonly toggleChecklistItem: {
				readonly ability: "toggle-checklist-item";
			};
			readonly addChecklistItem: {
				readonly ability: "add-checklist-item";
			};
			readonly removeChecklistItem: {
				readonly ability: "remove-checklist-item";
			};
			readonly snoozeTask: {
				readonly ability: "snooze-task";
			};
			readonly updateTask: {
				readonly ability: "update-task";
			};
			readonly deleteTask: {
				readonly ability: "delete-task";
				readonly destructive: true;
			};
			readonly createBucket: {
				readonly ability: "create-bucket";
			};
			readonly openTasksForAdmin: {
				readonly ability: "open-tasks-for-admin";
				readonly readonly: true;
				readonly idempotent: true;
			};
			readonly todoMetrics: {
				readonly ability: "todo-metrics";
				readonly readonly: true;
				readonly idempotent: true;
			};
		};
		readonly globals: {
			readonly settings: "settings";
		};
	};
	readonly collections: {
		readonly tasks: {
			readonly path: "tasks";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly softDelete: true;
			readonly localized: false;
			readonly relations: {
				readonly bucketIds: {
					readonly kind: "many";
					readonly collection: "buckets";
					readonly optional: false;
				};
				readonly blockedBy: {
					readonly kind: "one";
					readonly collection: "tasks";
					readonly optional: true;
				};
				readonly blocking: {
					readonly kind: "many";
					readonly collection: "tasks";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
			readonly ability: "tasks";
		};
		readonly buckets: {
			readonly path: "buckets";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly softDelete: false;
			readonly localized: false;
			readonly relations: {
				readonly tasks: {
					readonly kind: "many";
					readonly collection: "tasks";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
	};
	readonly globals: readonly ["settings"];
	readonly actions: readonly ["createTask", "toggleTask", "completeAndStopRecurring", "moveTaskBucket", "moveTaskColumn", "toggleChecklistItem", "addChecklistItem", "removeChecklistItem", "snoozeTask", "updateTask", "deleteTask", "createBucket", "openTasksForAdmin", "todoMetrics"];
	readonly buckets: readonly [];
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
	/** Soft-delete filter: `"exclude"` (default), `"include"`, or `"only"`. Non-default modes require `restore` or `delete` access. */
	deleted?: "exclude" | "include" | "only";
} & StatusQuery<K> & LocaleQuery<K>;
/**
* A read. Await it for one answer, or `subscribe` to keep it current: the callback gets the result
* now and again whenever it changes, always as this client's visitor reads it.
*/
export interface Query<T> extends Promise<T> {
	/** The same for the same call with the same arguments: what a cache or a hook keys on. */
	readonly key: string;
	/**
	* Calls `onData` with the result, and again each time it changes. `onError` gets the problem of a
	* read the server refuses (a `get` whose row is missing or unreadable is a 404) and network
	* failures; the subscription continues. `seed` is an answer rendered on the server
	* (`SpacePress\Live\Module::evaluate`): its data is delivered at once and its token sent with the
	* first request. Returns a function that ends the subscription.
	*/
	subscribe(onData: (data: T) => void, onError?: (error: SpacePressError) => void, seed?: {
		token: string;
		data: T;
	}): () => void;
	/**
	* Shows subscribers `update(current)` at once, before the server has answered a write. Call
	* `settle()` when the write succeeded (the change stays until the server's next answer replaces
	* it) or `rollback()` when it failed (subscribers get the server's data back).
	*/
	optimistic(update: (current: T) => T): {
		settle(): void;
		rollback(): void;
	};
}
export interface CollectionClient<K extends CollectionKey> {
	list<const W extends Collections[K]["with"] = Extract<{}, Collections[K]["with"]>>(q?: ListQuery<K, ExactWith<K, W>>): Query<RowWith<K, W>[]>;
	/**
	* One page and the `cursor` of the next (null on the last page): pass it back as `cursor`. A page
	* with `offset` can be awaited but not subscribed to (`subscribe` throws): subscribe by `cursor`.
	*/
	paginate<const W extends Collections[K]["with"] = Extract<{}, Collections[K]["with"]>>(q?: ListQuery<K, ExactWith<K, W>> & {
		cursor?: string | null;
	}): Query<{
		rows: RowWith<K, W>[];
		cursor: string | null;
	}>;
	/** With `locale`, the row of `id`'s translation group in that locale (or its fallback). */
	get<const W extends Collections[K]["with"] = Extract<{}, Collections[K]["with"]>>(id: IdOf<K>, q?: {
		with?: ExactWith<K, W>;
	} & LocaleQuery<K>): Query<RowWith<K, W>>;
	/** How many rows `list` with this filter would return without a limit. */
	count(q?: {
		where?: Collections[K]["filter"];
	} & StatusQuery<K> & LocaleQuery<K>): Query<number>;
	create(data: Collections[K]["insert"]): Promise<Row<K>>;
	/**
	* On a collection, add `_rev` (from a read) to the patch to refuse the update when the row changed
	* since: a 409 `stale_revision`. While someone else has the row open in the editor the update is a
	* 409 `locked`; `takeover: true` takes over their edit lock.
	*/
	update(id: IdOf<K>, patch: Collections[K]["patch"] & WriteConditions): Promise<Row<K>>;
	delete(id: IdOf<K>, options?: WriteConditions): Promise<Row<K>>;
	/** Restores a soft-deleted row (and any cascade-deleted children sharing its deletion group). */
	restore(id: IdOf<K>): Promise<Row<K>>;
	/** Permanently removes the row from storage (default access `"system"`). */
	purge(id: IdOf<K>): Promise<Row<K>>;
	/** `list(q).subscribe(onRows, onError)`. Returns a function that stops watching. */
	watch<const W extends Collections[K]["with"] = Extract<{}, Collections[K]["with"]>>(q: ListQuery<K, ExactWith<K, W>> | undefined, onRows: (rows: RowWith<K, W>[]) => void, onError?: (error: SpacePressError) => void): () => void;
	revisions: {
		/** Newest first. Needs `update` access on the row. */
		list(id: IdOf<K>): Promise<RevisionSummary[]>;
		get(id: IdOf<K>, revisionId: number): Promise<Row<K>>;
		/** Diffs two revisions (by version or revision id) as this viewer may read them. */
		diff(id: IdOf<K>, fromVersion: number, toVersion: number): Promise<RevisionDiff<Row<K>>>;
		/** Runs the update pipeline with the revision as the patch; returns the updated row. */
		restore(id: IdOf<K>, revisionId: number): Promise<Row<K>>;
	};
	/**
	* Save `patch` as the item's staged version: the live row stays as it is until `promote`. One
	* staged version per item, shared by everyone who may update it; each call adds to it. Post
	* kinds only. Every staged call needs `update` access on the row, and answers 404 without it.
	*/
	stage(id: IdOf<K>, patch: Collections[K]["patch"] & WriteConditions): Promise<StagedVersion<K>>;
	/** The staged version: the row as it would be once promoted. 404 when nothing is staged. */
	staged(id: IdOf<K>): Promise<StagedVersion<K>>;
	/** The staged fields whose value differs from the live row, with both values. */
	compare(id: IdOf<K>): Promise<StagedComparison<K>>;
	/**
	* Make the staged version live, as an update of the row by the caller. With `at` (a future ISO
	* time) the promote is scheduled instead, and `at: null` cancels a scheduled one; both return
	* the staged version.
	*/
	promote(id: IdOf<K>, options?: WriteConditions): Promise<Row<K>>;
	promote(id: IdOf<K>, options: {
		at: string | null;
	} & WriteConditions): Promise<StagedVersion<K>>;
	/** End the staged version. It stays in the row's revisions, as `revision`. */
	discard(id: IdOf<K>, options?: WriteConditions): Promise<{
		revision: number;
	}>;
	/** A signed link to the staged version that works without signing in for `ttl` seconds (an hour by default). */
	previewLink(id: IdOf<K>, options?: {
		ttl?: number;
	}): Promise<StagedPreview>;
}
/** A staged version: the row once promoted, the fields that are staged, who staged last. */
/**
* A write's conditions on a collection's row: `_rev`, the token a read returned (the row's own, or a
* staged version's for stage, promote and discard), refuses the write if the row changed since;
* `takeover` takes over another user's edit lock.
*/
export interface WriteConditions {
	_rev?: string;
	takeover?: boolean;
}
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
	/** The staged version's token, for the next stage, promote or discard. */
	_rev: string;
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
	/** `GET /wp-json/spacepress/v1`: the app's description (kinds, fields, globals, actions), as `spacepress pull` reads it. */
	schema(): Promise<unknown>;
};
/** One committed transaction's changes, as the runtime's `sp_realtime_changes` hook sends them. */
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
* Delivers change notices from the host (Cast, a WebSocket relay, Pusher, ...). SpacePress ships none.
* `connect` starts delivery and returns a stop function; call `status("live")` once notices flow
* and `status("down")` when they stop, so the client polls meanwhile.
*/
export interface RealtimeTransport {
	connect(deliver: (notice: ChangeNotice) => void, status: (state: "live" | "down") => void): () => void;
}
export interface RealtimeOptions {
	/** The transport. Default: the one a host registered with `registerRealtimeTransport`; `false` = polling only. */
	transport?: RealtimeTransport | false;
	/**
	* How often subscriptions ask the server while no transport is live. Default: adaptive, between
	* the bounds the server gives (2 s after a change, growing by half up to 30 s while nothing
	* changes, each wait jittered by 20%). `{ min, max }` sets the bounds, a number a fixed interval,
	* and `false` turns polling off. A hidden tab doesn't poll; it asks once when it is shown again.
	*/
	pollMs?: number | false | {
		min?: number;
		max?: number;
	};
	/**
	* A slow safety refresh while the transport is live, covering a notice the transport lost.
	* Default 60000 with up to ±20% jitter per refresh; `false` turns it off.
	*/
	livePollMs?: number | false;
}
/** For host scripts: every client on this page, created before or after, uses this transport by default. */
export declare function registerRealtimeTransport(transport: RealtimeTransport): void;
export interface ClientOptions {
	/**
	* The site's REST root: "https://x.test/wp-json" (or "https://x.test/?rest_route=" without pretty
	* permalinks; WordPress names it in the `Link: <…>; rel="https://api.w.org/"` header of every page).
	* The app's API URL ("https://x.test/wp-json/spacepress/v1") is accepted too, and a site URL without
	* either is taken as its `/wp-json`. Default: the root a SpacePress page names for the client, else
	* `/wp-json` on the page's origin.
	*/
	url?: string;
	/**
	* The app API's route below the REST root, when the site serves it somewhere other than
	* `/spacepress/v1` (`sp_api_namespace`). With it, `url` is taken as the REST root as given, so a
	* site with another REST prefix (`https://x.test/api`) works too. A SpacePress page names both.
	*/
	api?: string;
	/**
	* Use what a WordPress page prints for the client (`wp-script-module-data-@spacepress/client`): its
	* REST root and the app API's namespace (unless `url` is given), and a signed-in visitor's REST
	* nonce (unless `fetch`, `headers`, `nonce` or `auth` brings another credential; `true` uses it
	* anyway). Default: on; `false` ignores the page.
	*/
	wordpress?: boolean;
	/** WordPress cookie auth: the REST nonce; sent as `X-WP-Nonce` with `credentials: "same-origin"`. */
	nonce?: string;
	fetch?: typeof fetch;
	/** Extra headers on every request (e.g. `Authorization: Basic ...` for application passwords). They win over the above. */
	headers?: Record<string, string>;
	/** Frontend sign-in (design §6.2). */
	auth?: AuthOptions;
	/** Live updates for `subscribe` and `watch`. */
	realtime?: RealtimeOptions;
}
export interface AuthOptions {
	/** The spacepress-identity OIDC issuer (`https://x.test/identity`). Default: `issuer` from `GET /auth/config`. */
	issuer?: string;
	/** The registered application's client id. */
	clientId?: string;
	/** Where the issuer sends the browser back (the page that calls `handleCallback()`). */
	redirectUri?: string;
	/** Where tokens live: in memory (default) or `sessionStorage` under `spacepress.auth:<base url>`. */
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
export declare class SpacePressError extends Error {
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
* transport is live, or on its polling interval otherwise. For reads a `subscribe` can't express:
* an action's result, a global. Returns a function that stops watching.
*/
export declare function watch<T>(client: Client, collections: readonly CollectionKey[], read: () => Promise<T>, onResult: (value: T) => void, onError?: (error: SpacePressError) => void): () => void;
export {};
