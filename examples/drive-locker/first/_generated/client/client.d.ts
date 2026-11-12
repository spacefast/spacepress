export type Role = "guest" | "subscriber" | "author" | "editor" | "admin";
export interface User {
	id: number;
	name: string;
	role: Role;
	member?: Member | null;
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
export interface Drive {
	id: number;
	ownerId: number;
	label: string;
	model: string;
	serial: string;
	serialKey?: string;
	kind: "ssd" | "hdd" | "nvme" | "sd" | "usb";
	capacityGb: number;
	interface: string;
	purchasedOn: string | null;
	warrantyUntil: string | null;
	placeId: number | null;
	status: "in-use" | "spare" | "failed" | "retired";
	notes: string | null;
	tags: string[];
	replacementNeededAt: string | null;
}
export interface DriveInsert {
	ownerId?: number;
	label: string;
	model: string;
	serial: string;
	serialKey?: string;
	kind: "ssd" | "hdd" | "nvme" | "sd" | "usb";
	capacityGb: number;
	interface: string;
	purchasedOn?: string | null;
	warrantyUntil?: string | null;
	placeId?: number | null;
	status?: "in-use" | "spare" | "failed" | "retired";
	notes?: string | null;
	tags?: string[];
	replacementNeededAt?: string | null;
}
export interface DrivePatch {
	ownerId?: number;
	label?: string;
	model?: string;
	serial?: string;
	serialKey?: string;
	kind?: "ssd" | "hdd" | "nvme" | "sd" | "usb";
	capacityGb?: number;
	interface?: string;
	purchasedOn?: string | null;
	warrantyUntil?: string | null;
	placeId?: number | null;
	status?: "in-use" | "spare" | "failed" | "retired";
	notes?: string | null;
	tags?: string[];
	replacementNeededAt?: string | null;
}
export interface DriveWith {
	place?: true | {
		where?: PlaceFilter;
		orderBy?: PlaceOrder;
		limit?: number;
		offset?: number;
		with?: PlaceWith;
	};
	healthReadings?: true | {
		where?: HealthReadingFilter;
		orderBy?: HealthReadingOrder;
		limit?: number;
		offset?: number;
		with?: HealthReadingWith;
	};
	contents?: true | {
		where?: ContentFilter;
		orderBy?: ContentOrder;
		limit?: number;
		offset?: number;
		with?: ContentWith;
	};
}
export interface DriveFilter {
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
	label?: string | null | {
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
	serial?: string | null | {
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
	serialKey?: string | null | {
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
	kind?: "ssd" | "hdd" | "nvme" | "sd" | "usb" | null | {
		eq?: "ssd" | "hdd" | "nvme" | "sd" | "usb" | null;
		ne?: "ssd" | "hdd" | "nvme" | "sd" | "usb" | null;
		gt?: "ssd" | "hdd" | "nvme" | "sd" | "usb";
		gte?: "ssd" | "hdd" | "nvme" | "sd" | "usb";
		lt?: "ssd" | "hdd" | "nvme" | "sd" | "usb";
		lte?: "ssd" | "hdd" | "nvme" | "sd" | "usb";
		in?: ("ssd" | "hdd" | "nvme" | "sd" | "usb")[];
		notIn?: ("ssd" | "hdd" | "nvme" | "sd" | "usb")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	capacityGb?: number | null | {
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
	interface?: string | null | {
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
	purchasedOn?: string | null | {
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
	warrantyUntil?: string | null | {
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
	placeId?: number | null | {
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
	status?: "in-use" | "spare" | "failed" | "retired" | null | {
		eq?: "in-use" | "spare" | "failed" | "retired" | null;
		ne?: "in-use" | "spare" | "failed" | "retired" | null;
		gt?: "in-use" | "spare" | "failed" | "retired";
		gte?: "in-use" | "spare" | "failed" | "retired";
		lt?: "in-use" | "spare" | "failed" | "retired";
		lte?: "in-use" | "spare" | "failed" | "retired";
		in?: ("in-use" | "spare" | "failed" | "retired")[];
		notIn?: ("in-use" | "spare" | "failed" | "retired")[];
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
	tags?: string[] | null | {
		eq?: string[] | null;
		ne?: string[] | null;
		isNull?: true;
		isNotNull?: true;
	};
	replacementNeededAt?: string | null | {
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
	place?: true | PlaceFilter;
	healthReadings?: true | HealthReadingFilter;
	contents?: true | ContentFilter;
	AND?: DriveFilter[];
	OR?: DriveFilter[];
	NOT?: DriveFilter;
}
export type DriveOrder = Partial<Record<"id" | "ownerId" | "label" | "model" | "serial" | "serialKey" | "kind" | "capacityGb" | "interface" | "purchasedOn" | "warrantyUntil" | "placeId" | "status" | "notes" | "replacementNeededAt", "asc" | "desc">> | string;
export interface Place {
	id: number;
	ownerId: number;
	name: string;
	kind: "nas-bay" | "desktop" | "laptop" | "drawer" | "offsite";
}
export interface PlaceInsert {
	ownerId?: number;
	name: string;
	kind: "nas-bay" | "desktop" | "laptop" | "drawer" | "offsite";
}
export interface PlacePatch {
	ownerId?: number;
	name?: string;
	kind?: "nas-bay" | "desktop" | "laptop" | "drawer" | "offsite";
}
export interface PlaceWith {
	drives?: true | {
		where?: DriveFilter;
		orderBy?: DriveOrder;
		limit?: number;
		offset?: number;
		with?: DriveWith;
	};
}
export interface PlaceFilter {
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
	kind?: "nas-bay" | "desktop" | "laptop" | "drawer" | "offsite" | null | {
		eq?: "nas-bay" | "desktop" | "laptop" | "drawer" | "offsite" | null;
		ne?: "nas-bay" | "desktop" | "laptop" | "drawer" | "offsite" | null;
		gt?: "nas-bay" | "desktop" | "laptop" | "drawer" | "offsite";
		gte?: "nas-bay" | "desktop" | "laptop" | "drawer" | "offsite";
		lt?: "nas-bay" | "desktop" | "laptop" | "drawer" | "offsite";
		lte?: "nas-bay" | "desktop" | "laptop" | "drawer" | "offsite";
		in?: ("nas-bay" | "desktop" | "laptop" | "drawer" | "offsite")[];
		notIn?: ("nas-bay" | "desktop" | "laptop" | "drawer" | "offsite")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	drives?: true | DriveFilter;
	AND?: PlaceFilter[];
	OR?: PlaceFilter[];
	NOT?: PlaceFilter;
}
export type PlaceOrder = Partial<Record<"id" | "ownerId" | "name" | "kind", "asc" | "desc">> | string;
export interface HealthReading {
	id: number;
	ownerId: number;
	driveId: number;
	readOn: string;
	powerOnHours: number;
	wearPercent: number;
	reallocatedSectors: number;
	tempC: number;
}
export interface HealthReadingInsert {
	ownerId?: number;
	driveId: number;
	readOn: string;
	powerOnHours: number;
	wearPercent: number;
	reallocatedSectors: number;
	tempC: number;
}
export interface HealthReadingPatch {
	ownerId?: number;
	driveId?: number;
	readOn?: string;
	powerOnHours?: number;
	wearPercent?: number;
	reallocatedSectors?: number;
	tempC?: number;
}
export interface HealthReadingWith {
	drive?: true | {
		where?: DriveFilter;
		orderBy?: DriveOrder;
		limit?: number;
		offset?: number;
		with?: DriveWith;
	};
}
export interface HealthReadingFilter {
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
	driveId?: number | null | {
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
	readOn?: string | null | {
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
	powerOnHours?: number | null | {
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
	wearPercent?: number | null | {
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
	reallocatedSectors?: number | null | {
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
	tempC?: number | null | {
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
	drive?: true | DriveFilter;
	AND?: HealthReadingFilter[];
	OR?: HealthReadingFilter[];
	NOT?: HealthReadingFilter;
}
export type HealthReadingOrder = Partial<Record<"id" | "ownerId" | "driveId" | "readOn" | "powerOnHours" | "wearPercent" | "reallocatedSectors" | "tempC", "asc" | "desc">> | string;
export interface Content {
	id: number;
	ownerId: number;
	driveId: number;
	description: string;
	usedGb: number;
	lastBackupOn: string | null;
}
export interface ContentInsert {
	ownerId?: number;
	driveId: number;
	description: string;
	usedGb: number;
	lastBackupOn?: string | null;
}
export interface ContentPatch {
	ownerId?: number;
	driveId?: number;
	description?: string;
	usedGb?: number;
	lastBackupOn?: string | null;
}
export interface ContentWith {
	drive?: true | {
		where?: DriveFilter;
		orderBy?: DriveOrder;
		limit?: number;
		offset?: number;
		with?: DriveWith;
	};
}
export interface ContentFilter {
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
	driveId?: number | null | {
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
	usedGb?: number | null | {
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
	lastBackupOn?: string | null | {
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
	drive?: true | DriveFilter;
	AND?: ContentFilter[];
	OR?: ContentFilter[];
	NOT?: ContentFilter;
}
export type ContentOrder = Partial<Record<"id" | "ownerId" | "driveId" | "description" | "usedGb" | "lastBackupOn", "asc" | "desc">> | string;
export interface Member {
	id: number;
	email: string;
	name: string;
	role: "guest" | "subscriber" | "author" | "editor" | "admin";
}
export interface MemberInsert {
	email: string;
	name: string;
	role?: "guest" | "subscriber" | "author" | "editor" | "admin";
	password?: string;
}
export interface MemberPatch {
	email?: string;
	name?: string;
	role?: "guest" | "subscriber" | "author" | "editor" | "admin";
	password?: string;
}
export interface MemberWith {}
export interface MemberFilter {
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
	email?: string | null | {
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
	role?: "guest" | "subscriber" | "author" | "editor" | "admin" | null | {
		eq?: "guest" | "subscriber" | "author" | "editor" | "admin" | null;
		ne?: "guest" | "subscriber" | "author" | "editor" | "admin" | null;
		gt?: "guest" | "subscriber" | "author" | "editor" | "admin";
		gte?: "guest" | "subscriber" | "author" | "editor" | "admin";
		lt?: "guest" | "subscriber" | "author" | "editor" | "admin";
		lte?: "guest" | "subscriber" | "author" | "editor" | "admin";
		in?: ("guest" | "subscriber" | "author" | "editor" | "admin")[];
		notIn?: ("guest" | "subscriber" | "author" | "editor" | "admin")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	AND?: MemberFilter[];
	OR?: MemberFilter[];
	NOT?: MemberFilter;
}
export type MemberOrder = Partial<Record<"id" | "email" | "name" | "role", "asc" | "desc">> | string;
export interface LogHealthInput {
	driveId: number;
	readOn: string;
	powerOnHours: number;
	wearPercent: number;
	reallocatedSectors: number;
	tempC: number;
}
export type LogHealthOutput = {
	reading: HealthReading;
	verdict: string;
};
export interface WhereIsInput {
	query: string;
}
export type WhereIsOutput = ({
	drive: {
		id: number;
		ownerId: number;
		label: string;
		model: string;
		serial: string;
		serialKey: string;
		kind: "ssd" | "hdd" | "nvme" | "sd" | "usb";
		capacityGb: number;
		interface: string;
		purchasedOn: string | null;
		warrantyUntil: string | null;
		placeId: number | null;
		status: "in-use" | "spare" | "failed" | "retired";
		notes: string | null;
		tags: string[];
		replacementNeededAt: string | null;
		place: Place | null;
		contents: Content[];
	};
	place: Place | null;
	contents: Content[];
})[];
export type CapacityReportInput = Record<string, never>;
export type CapacityReportOutput = {
	totalGb: number;
	usedGb: number;
	freeGb: number;
	byPlace: ({
		placeId: number | null;
		name: string;
		totalGb: number;
		usedGb: number;
		freeGb: number;
	})[];
	byKind: [{
		kind: string;
		totalGb: number;
		usedGb: number;
		freeGb: number;
	}, ...({
		kind: string;
		totalGb: number;
		usedGb: number;
		freeGb: number;
	})[]];
};
export interface WarrantyExpiringInput {
	days?: number;
}
export type WarrantyExpiringOutput = ({
	id: number;
	ownerId: number;
	label: string;
	model: string;
	serial: string;
	serialKey: string;
	kind: "ssd" | "hdd" | "nvme" | "sd" | "usb";
	capacityGb: number;
	interface: string;
	purchasedOn: string | null;
	warrantyUntil: string | null;
	placeId: number | null;
	status: "in-use" | "spare" | "failed" | "retired";
	notes: string | null;
	tags: string[];
	replacementNeededAt: string | null;
	place: Place | null;
})[];
export interface RetireInput {
	driveId: number;
}
export type RetireOutput = {
	id: number;
	ownerId: number;
	label: string;
	model: string;
	serial: string;
	kind: "ssd" | "hdd" | "nvme" | "sd" | "usb";
	capacityGb: number;
	interface: string;
	purchasedOn: string | null;
	warrantyUntil: string | null;
	placeId: number | null;
	status: "in-use" | "spare" | "failed" | "retired";
	notes: string | null;
	tags: string[];
	replacementNeededAt: string | null;
};
export interface Collections {
	drives: {
		row: Drive;
		insert: DriveInsert;
		patch: DrivePatch;
		with: DriveWith;
		filter: DriveFilter;
		order: DriveOrder;
	};
	places: {
		row: Place;
		insert: PlaceInsert;
		patch: PlacePatch;
		with: PlaceWith;
		filter: PlaceFilter;
		order: PlaceOrder;
	};
	healthReadings: {
		row: HealthReading;
		insert: HealthReadingInsert;
		patch: HealthReadingPatch;
		with: HealthReadingWith;
		filter: HealthReadingFilter;
		order: HealthReadingOrder;
	};
	contents: {
		row: Content;
		insert: ContentInsert;
		patch: ContentPatch;
		with: ContentWith;
		filter: ContentFilter;
		order: ContentOrder;
	};
	members: {
		row: Member;
		insert: MemberInsert;
		patch: MemberPatch;
		with: MemberWith;
		filter: MemberFilter;
		order: MemberOrder;
	};
}
export interface Globals {}
export interface Actions {
	logHealth: {
		input: LogHealthInput;
		output: LogHealthOutput;
	};
	whereIs: {
		input: WhereIsInput;
		output: WhereIsOutput;
	};
	capacityReport: {
		input: CapacityReportInput;
		output: CapacityReportOutput;
	};
	warrantyExpiring: {
		input: WarrantyExpiringInput;
		output: WarrantyExpiringOutput;
	};
	retire: {
		input: RetireInput;
		output: RetireOutput;
	};
}
export declare const SCHEMA: {
	readonly name: "drive-locker";
	readonly collections: {
		readonly drives: {
			readonly path: "drives";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {
				readonly place: {
					readonly kind: "one";
					readonly collection: "places";
					readonly optional: true;
				};
				readonly healthReadings: {
					readonly kind: "many";
					readonly collection: "healthReadings";
					readonly optional: false;
				};
				readonly contents: {
					readonly kind: "many";
					readonly collection: "contents";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly places: {
			readonly path: "places";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {
				readonly drives: {
					readonly kind: "many";
					readonly collection: "drives";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly healthReadings: {
			readonly path: "health_readings";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {
				readonly drive: {
					readonly kind: "one";
					readonly collection: "drives";
					readonly optional: true;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly contents: {
			readonly path: "contents";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {
				readonly drive: {
					readonly kind: "one";
					readonly collection: "drives";
					readonly optional: true;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly members: {
			readonly path: "members";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
	};
	readonly globals: readonly [];
	readonly actions: readonly ["logHealth", "whereIs", "capacityReport", "warrantyExpiring", "retire"];
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
