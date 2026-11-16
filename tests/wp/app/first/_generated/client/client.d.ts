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
export type Locale = "en" | "de" | "fr";
export interface Event {
	id: number;
	title: string;
	seats: number | null;
	price: number | null;
	open: boolean;
	day: string | null;
	startsAt: string | null;
	kinds: ("talk" | "workshop" | "social")[];
	postId: number | null;
	extra: unknown | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface EventInsert {
	title: string;
	seats?: number | null;
	price?: number | null;
	open?: boolean;
	day?: string | null;
	startsAt?: string | null;
	kinds?: ("talk" | "workshop" | "social")[];
	postId?: number | null;
	extra?: unknown | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface EventPatch {
	title?: string;
	seats?: number | null;
	price?: number | null;
	open?: boolean;
	day?: string | null;
	startsAt?: string | null;
	kinds?: ("talk" | "workshop" | "social")[];
	postId?: number | null;
	extra?: unknown | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface EventWith {
	postId?: true | {
		where?: PostFilter;
		orderBy?: PostOrder;
		limit?: number;
		offset?: number;
		with?: PostWith;
	};
}
export interface EventFilter {
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
	seats?: number | null | {
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
	price?: number | null | {
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
	open?: boolean | null | {
		eq?: boolean | null;
		ne?: boolean | null;
		gt?: boolean;
		gte?: boolean;
		lt?: boolean;
		lte?: boolean;
		in?: boolean[];
		notIn?: boolean[];
		isNull?: true;
		isNotNull?: true;
	};
	day?: string | null | {
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
	startsAt?: string | null | {
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
	kinds?: [] | null | {
		has?: "talk" | "workshop" | "social";
		eq?: [];
		isNull?: true;
		isNotNull?: true;
	};
	postId?: number | null | {
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
	} | PostFilter;
	extra?: unknown | null | {
		eq?: unknown | null;
		ne?: unknown | null;
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
	AND?: EventFilter[];
	OR?: EventFilter[];
	NOT?: EventFilter;
}
export type EventOrder = Partial<Record<"id" | "title" | "seats" | "price" | "open" | "day" | "startsAt" | "postId" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface Author {
	id: number;
	name: string;
	email: string;
	bio: string | null;
	avatar: number | null;
	userId: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface AuthorInsert {
	name: string;
	email: string;
	bio?: string | null;
	avatar?: number | null;
	userId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface AuthorPatch {
	name?: string;
	email?: string;
	bio?: string | null;
	avatar?: number | null;
	userId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface AuthorWith {
	posts?: true | {
		where?: PostFilter;
		orderBy?: PostOrder;
		limit?: number;
		offset?: number;
		with?: PostWith;
	};
	avatar?: true;
}
export interface AuthorFilter {
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
	bio?: string | null | {
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
	avatar?: number | null | {
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
	userId?: number | null | {
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
	posts?: true | PostFilter;
	AND?: AuthorFilter[];
	OR?: AuthorFilter[];
	NOT?: AuthorFilter;
}
export type AuthorOrder = Partial<Record<"id" | "name" | "email" | "bio" | "avatar" | "userId" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface Post {
	id: number;
	title: string;
	slug: string | null;
	body: string | null;
	excerpt: string | null;
	cover: number | null;
	tags: ("news" | "guide" | "release")[];
	authorId: number | null;
	seo: {
		metaTitle: string | null;
		metaDescription: string | null;
		noindex: boolean;
	} | null;
	gallery: {
		image: number;
		caption: string | null;
	}[] | null;
	sections: ({
		layout: "hero";
		heading: string;
		image: number | null;
	} | {
		layout: "quote";
		text: string;
		cite: string | null;
	})[] | null;
	createdAt: string;
	updatedAt: string;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface PostInsert {
	title: string;
	slug?: string | null;
	body?: string | null;
	excerpt?: string | null;
	cover?: number | null;
	tags?: ("news" | "guide" | "release")[];
	authorId?: number | null;
	seo?: {
		metaTitle?: string | null;
		metaDescription?: string | null;
		noindex?: boolean;
	} | null;
	gallery?: {
		image: number;
		caption?: string | null;
	}[] | null;
	sections?: ({
		layout: "hero";
		heading: string;
		image?: number | null;
	} | {
		layout: "quote";
		text: string;
		cite?: string | null;
	})[] | null;
	createdAt?: string;
	updatedAt?: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface PostPatch {
	title?: string;
	slug?: string | null;
	body?: string | null;
	excerpt?: string | null;
	cover?: number | null;
	tags?: ("news" | "guide" | "release")[];
	authorId?: number | null;
	seo?: {
		metaTitle?: string | null;
		metaDescription?: string | null;
		noindex?: boolean;
	} | null;
	gallery?: {
		image: number;
		caption?: string | null;
	}[] | null;
	sections?: ({
		layout: "hero";
		heading: string;
		image?: number | null;
	} | {
		layout: "quote";
		text: string;
		cite?: string | null;
	})[] | null;
	createdAt?: string;
	updatedAt?: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface PostWith {
	authorId?: true | {
		where?: AuthorFilter;
		orderBy?: AuthorOrder;
		limit?: number;
		offset?: number;
		with?: AuthorWith;
	};
	events?: true | {
		where?: EventFilter;
		orderBy?: EventOrder;
		limit?: number;
		offset?: number;
		with?: EventWith;
	};
	fieldStaff?: true | {
		where?: FieldStaffFilter;
		orderBy?: FieldStaffOrder;
		limit?: number;
		offset?: number;
		with?: FieldStaffWith;
	};
	signups?: true | {
		where?: SignupFilter;
		orderBy?: SignupOrder;
		limit?: number;
		offset?: number;
		with?: SignupWith;
	};
	comments?: true | {
		where?: CommentFilter;
		orderBy?: CommentOrder;
		limit?: number;
		offset?: number;
		with?: CommentWith;
	};
	cover?: true;
}
export interface PostFilter {
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
	body?: string | null | {
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
	excerpt?: string | null | {
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
	cover?: number | null | {
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
	tags?: [] | null | {
		has?: "news" | "guide" | "release";
		eq?: [];
		isNull?: true;
		isNotNull?: true;
	};
	authorId?: number | null | {
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
	} | AuthorFilter;
	seo?: {
		metaTitle: string | null;
		metaDescription: string | null;
		noindex: boolean;
	} | null | {
		eq?: {
			metaTitle: string | null;
			metaDescription: string | null;
			noindex: boolean;
		} | null;
		ne?: {
			metaTitle: string | null;
			metaDescription: string | null;
			noindex: boolean;
		} | null;
		isNull?: true;
		isNotNull?: true;
	};
	gallery?: {
		image: number;
		caption: string | null;
	}[] | null | {
		eq?: {
			image: number;
			caption: string | null;
		}[] | null;
		ne?: {
			image: number;
			caption: string | null;
		}[] | null;
		isNull?: true;
		isNotNull?: true;
	};
	sections?: ({
		layout: "hero";
		heading: string;
		image: number | null;
	} | {
		layout: "quote";
		text: string;
		cite: string | null;
	})[] | null | {
		eq?: ({
			layout: "hero";
			heading: string;
			image: number | null;
		} | {
			layout: "quote";
			text: string;
			cite: string | null;
		})[] | null;
		ne?: ({
			layout: "hero";
			heading: string;
			image: number | null;
		} | {
			layout: "quote";
			text: string;
			cite: string | null;
		})[] | null;
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
	events?: true | EventFilter;
	fieldStaff?: true | FieldStaffFilter;
	signups?: true | SignupFilter;
	comments?: true | CommentFilter;
	AND?: PostFilter[];
	OR?: PostFilter[];
	NOT?: PostFilter;
}
export type PostOrder = Partial<Record<"id" | "title" | "slug" | "body" | "excerpt" | "cover" | "authorId" | "createdAt" | "updatedAt" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface FieldStaff {
	id: number;
	name: string;
	email?: string | null;
	ownerId: number | null;
	salary?: number | null;
	kind: "basic" | "pro" | null;
	active: boolean | null;
	plan: string | null;
	discount: number | null;
	headline: string | null;
	postNote: string | null;
	always: string | null;
	postId: number | null;
	notes: {
		public: string | null;
		private?: string | null;
	} | null;
	teamId: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface FieldStaffInsert {
	name: string;
	email?: string | null;
	ownerId?: number | null;
	salary?: number | null;
	kind?: "basic" | "pro" | null;
	active?: boolean | null;
	plan?: string | null;
	discount?: number | null;
	headline?: string | null;
	postNote?: string | null;
	always?: string | null;
	postId?: number | null;
	notes?: {
		public?: string | null;
		private?: string | null;
	} | null;
	teamId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface FieldStaffPatch {
	name?: string;
	email?: string | null;
	ownerId?: number | null;
	salary?: number | null;
	kind?: "basic" | "pro" | null;
	active?: boolean | null;
	plan?: string | null;
	discount?: number | null;
	headline?: string | null;
	postNote?: string | null;
	always?: string | null;
	postId?: number | null;
	notes?: {
		public?: string | null;
		private?: string | null;
	} | null;
	teamId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface FieldStaffWith {
	postId?: true | {
		where?: PostFilter;
		orderBy?: PostOrder;
		limit?: number;
		offset?: number;
		with?: PostWith;
	};
	teamId?: true | {
		where?: FieldTeamFilter;
		orderBy?: FieldTeamOrder;
		limit?: number;
		offset?: number;
		with?: FieldTeamWith;
	};
}
export interface FieldStaffFilter {
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
	salary?: number | null | {
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
	kind?: "basic" | "pro" | null | {
		eq?: "basic" | "pro" | null;
		ne?: "basic" | "pro" | null;
		gt?: "basic" | "pro";
		gte?: "basic" | "pro";
		lt?: "basic" | "pro";
		lte?: "basic" | "pro";
		in?: ("basic" | "pro")[];
		notIn?: ("basic" | "pro")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	active?: boolean | null | {
		eq?: boolean | null;
		ne?: boolean | null;
		gt?: boolean;
		gte?: boolean;
		lt?: boolean;
		lte?: boolean;
		in?: boolean[];
		notIn?: boolean[];
		isNull?: true;
		isNotNull?: true;
	};
	plan?: string | null | {
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
	discount?: number | null | {
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
	headline?: string | null | {
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
	postNote?: string | null | {
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
	always?: string | null | {
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
	postId?: number | null | {
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
	} | PostFilter;
	notes?: {
		public: string | null;
		private?: string | null;
	} | null | {
		eq?: {
			public: string | null;
			private?: string | null;
		} | null;
		ne?: {
			public: string | null;
			private?: string | null;
		} | null;
		isNull?: true;
		isNotNull?: true;
	};
	teamId?: number | null | {
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
	} | FieldTeamFilter;
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
	AND?: FieldStaffFilter[];
	OR?: FieldStaffFilter[];
	NOT?: FieldStaffFilter;
}
export type FieldStaffOrder = Partial<Record<"id" | "name" | "email" | "ownerId" | "salary" | "kind" | "active" | "plan" | "discount" | "headline" | "postNote" | "always" | "postId" | "teamId" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface Tour {
	id: number;
	title: string;
	summary: string | null;
	slug: string | null;
	price: number | null;
	tags: ("tea" | "coffee")[];
	body: string | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
	uid: string | null;
	locale: "en" | "de" | "fr";
	translations: Partial<Record<"en" | "de" | "fr", number>>;
}
export interface TourFields {
	title: string;
	summary?: string | null;
	slug?: string | null;
	price?: number | null;
	tags?: ("tea" | "coffee")[];
	body?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
	locale?: "en" | "de" | "fr";
	translationOf?: undefined;
}
export type TourInsert = TourFields | (Omit<TourFields, "price" | "tags" | "translationOf"> & Partial<Pick<TourFields, "price" | "tags">> & {
	translationOf: number;
});
export interface TourPatch {
	title?: string;
	summary?: string | null;
	slug?: string | null;
	price?: number | null;
	tags?: ("tea" | "coffee")[];
	body?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface TourWith {
	legs?: true | {
		where?: LegFilter;
		orderBy?: LegOrder;
		limit?: number;
		offset?: number;
		with?: LegWith;
	};
}
export interface TourFilter {
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
	summary?: string | null | {
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
	price?: number | null | {
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
	tags?: [] | null | {
		has?: "tea" | "coffee";
		eq?: [];
		isNull?: true;
		isNotNull?: true;
	};
	body?: string | null | {
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
	locale?: "en" | "de" | "fr" | null | {
		eq?: "en" | "de" | "fr" | null;
		ne?: "en" | "de" | "fr" | null;
		gt?: "en" | "de" | "fr";
		gte?: "en" | "de" | "fr";
		lt?: "en" | "de" | "fr";
		lte?: "en" | "de" | "fr";
		in?: ("en" | "de" | "fr")[];
		notIn?: ("en" | "de" | "fr")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	legs?: true | LegFilter;
	AND?: TourFilter[];
	OR?: TourFilter[];
	NOT?: TourFilter;
}
export type TourOrder = Partial<Record<"id" | "title" | "summary" | "slug" | "price" | "body" | "status" | "publishedAt" | "uid" | "locale", "asc" | "desc">> | string;
export interface Talk {
	id: number;
	title: string;
	deck: number | null;
	image: number | null;
	extras: {
		handout: number | null;
	} | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface TalkInsert {
	title: string;
	deck?: number | null;
	image?: number | null;
	extras?: {
		handout?: number | null;
	} | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface TalkPatch {
	title?: string;
	deck?: number | null;
	image?: number | null;
	extras?: {
		handout?: number | null;
	} | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface TalkWith {
	deck?: true;
	image?: true;
}
export interface TalkFilter {
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
	deck?: number | null | {
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
	image?: number | null | {
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
	extras?: {
		handout: number | null;
	} | null | {
		eq?: {
			handout: number | null;
		} | null;
		ne?: {
			handout: number | null;
		} | null;
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
	AND?: TalkFilter[];
	OR?: TalkFilter[];
	NOT?: TalkFilter;
}
export type TalkOrder = Partial<Record<"id" | "title" | "deck" | "image" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface Vault {
	id: number;
	title: string;
	code: string | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface VaultInsert {
	title: string;
	code?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface VaultPatch {
	title?: string;
	code?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface VaultWith {}
export interface VaultFilter {
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
	code?: string | null | {
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
	AND?: VaultFilter[];
	OR?: VaultFilter[];
	NOT?: VaultFilter;
}
export type VaultOrder = Partial<Record<"id" | "title" | "code" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface Ledger {
	id: number;
	title: string;
	ownerId: number | null;
	bonus?: string | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface LedgerInsert {
	title: string;
	ownerId?: number | null;
	bonus?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface LedgerPatch {
	title?: string;
	ownerId?: number | null;
	bonus?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface LedgerWith {
	payroll?: true | {
		where?: PayrollFilter;
		orderBy?: PayrollOrder;
		limit?: number;
		offset?: number;
		with?: PayrollWith;
	};
}
export interface LedgerFilter {
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
	bonus?: string | null | {
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
	payroll?: true | PayrollFilter;
	AND?: LedgerFilter[];
	OR?: LedgerFilter[];
	NOT?: LedgerFilter;
}
export type LedgerOrder = Partial<Record<"id" | "title" | "ownerId" | "bonus" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface Payroll {
	id: number;
	title: string;
	salary?: string | null;
	notes: {
		open: string | null;
		sealed?: string | null;
	} | null;
	entries: {
		open: string | null;
		sealed?: string | null;
	}[] | null;
	sections: ({
		layout: "private";
		sealed?: string | null;
	} | {
		layout: "public";
		open: string | null;
	})[] | null;
	policy: {
		gate: string | null;
		value: string | null;
	} | null;
	badge?: number | null;
	writeOnly?: string | null;
	managerId?: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface PayrollInsert {
	title: string;
	salary?: string | null;
	notes?: {
		open?: string | null;
		sealed?: string | null;
	} | null;
	entries?: {
		open?: string | null;
		sealed?: string | null;
	}[] | null;
	sections?: ({
		layout: "private";
		sealed?: string | null;
	} | {
		layout: "public";
		open?: string | null;
	})[] | null;
	policy?: {
		gate?: string | null;
		value?: string | null;
	} | null;
	badge?: number | null;
	writeOnly?: string | null;
	managerId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface PayrollPatch {
	title?: string;
	salary?: string | null;
	notes?: {
		open?: string | null;
		sealed?: string | null;
	} | null;
	entries?: {
		open?: string | null;
		sealed?: string | null;
	}[] | null;
	sections?: ({
		layout: "private";
		sealed?: string | null;
	} | {
		layout: "public";
		open?: string | null;
	})[] | null;
	policy?: {
		gate?: string | null;
		value?: string | null;
	} | null;
	badge?: number | null;
	writeOnly?: string | null;
	managerId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface PayrollWith {
	managerId?: true | {
		where?: LedgerFilter;
		orderBy?: LedgerOrder;
		limit?: number;
		offset?: number;
		with?: LedgerWith;
	};
}
export interface PayrollFilter {
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
	salary?: string | null | {
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
	notes?: {
		open: string | null;
		sealed?: string | null;
	} | null | {
		eq?: {
			open: string | null;
			sealed?: string | null;
		} | null;
		ne?: {
			open: string | null;
			sealed?: string | null;
		} | null;
		isNull?: true;
		isNotNull?: true;
	};
	entries?: {
		open: string | null;
		sealed?: string | null;
	}[] | null | {
		eq?: {
			open: string | null;
			sealed?: string | null;
		}[] | null;
		ne?: {
			open: string | null;
			sealed?: string | null;
		}[] | null;
		isNull?: true;
		isNotNull?: true;
	};
	sections?: ({
		layout: "private";
		sealed?: string | null;
	} | {
		layout: "public";
		open: string | null;
	})[] | null | {
		eq?: ({
			layout: "private";
			sealed?: string | null;
		} | {
			layout: "public";
			open: string | null;
		})[] | null;
		ne?: ({
			layout: "private";
			sealed?: string | null;
		} | {
			layout: "public";
			open: string | null;
		})[] | null;
		isNull?: true;
		isNotNull?: true;
	};
	policy?: {
		gate: string | null;
		value: string | null;
	} | null | {
		eq?: {
			gate: string | null;
			value: string | null;
		} | null;
		ne?: {
			gate: string | null;
			value: string | null;
		} | null;
		isNull?: true;
		isNotNull?: true;
	};
	badge?: number | null | {
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
	writeOnly?: string | null | {
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
	managerId?: number | null | {
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
	} | LedgerFilter;
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
	AND?: PayrollFilter[];
	OR?: PayrollFilter[];
	NOT?: PayrollFilter;
}
export type PayrollOrder = Partial<Record<"id" | "title" | "salary" | "badge" | "writeOnly" | "managerId" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface Dossier {
	id: number;
	title: string;
	slug?: string | null;
	body?: string | null;
	payload: unknown | null;
	entries: {
		metadata: unknown | null;
	}[] | null;
	sections: ({
		layout: "first";
		configuration: unknown | null;
	} | {
		layout: "second";
		configuration: unknown | null;
	})[] | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface DossierInsert {
	title: string;
	slug?: string | null;
	body?: string | null;
	payload?: unknown | null;
	entries?: {
		metadata?: unknown | null;
	}[] | null;
	sections?: ({
		layout: "first";
		configuration?: unknown | null;
	} | {
		layout: "second";
		configuration?: unknown | null;
	})[] | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface DossierPatch {
	title?: string;
	slug?: string | null;
	body?: string | null;
	payload?: unknown | null;
	entries?: {
		metadata?: unknown | null;
	}[] | null;
	sections?: ({
		layout: "first";
		configuration?: unknown | null;
	} | {
		layout: "second";
		configuration?: unknown | null;
	})[] | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface DossierWith {}
export interface DossierFilter {
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
	body?: string | null | {
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
	payload?: unknown | null | {
		eq?: unknown | null;
		ne?: unknown | null;
		isNull?: true;
		isNotNull?: true;
	};
	entries?: {
		metadata: unknown | null;
	}[] | null | {
		eq?: {
			metadata: unknown | null;
		}[] | null;
		ne?: {
			metadata: unknown | null;
		}[] | null;
		isNull?: true;
		isNotNull?: true;
	};
	sections?: ({
		layout: "first";
		configuration: unknown | null;
	} | {
		layout: "second";
		configuration: unknown | null;
	})[] | null | {
		eq?: ({
			layout: "first";
			configuration: unknown | null;
		} | {
			layout: "second";
			configuration: unknown | null;
		})[] | null;
		ne?: ({
			layout: "first";
			configuration: unknown | null;
		} | {
			layout: "second";
			configuration: unknown | null;
		})[] | null;
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
	AND?: DossierFilter[];
	OR?: DossierFilter[];
	NOT?: DossierFilter;
}
export type DossierOrder = Partial<Record<"id" | "title" | "slug" | "body" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface Claim {
	id: number;
	title: string;
	ownerId: number | null;
	meta: unknown | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface ClaimInsert {
	title: string;
	ownerId?: number | null;
	meta?: unknown | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface ClaimPatch {
	title?: string;
	ownerId?: number | null;
	meta?: unknown | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface ClaimWith {}
export interface ClaimFilter {
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
	meta?: unknown | null | {
		eq?: unknown | null;
		ne?: unknown | null;
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
	AND?: ClaimFilter[];
	OR?: ClaimFilter[];
	NOT?: ClaimFilter;
}
export type ClaimOrder = Partial<Record<"id" | "title" | "ownerId" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface Gated {
	id: number;
	title: string;
	level: string | null;
	notes: {
		open: string | null;
		sealed?: string | null;
	} | null;
	ownerId: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface GatedInsert {
	title: string;
	level?: string | null;
	notes?: {
		open?: string | null;
		sealed?: string | null;
	} | null;
	ownerId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface GatedPatch {
	title?: string;
	level?: string | null;
	notes?: {
		open?: string | null;
		sealed?: string | null;
	} | null;
	ownerId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface GatedWith {}
export interface GatedFilter {
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
	level?: string | null | {
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
	notes?: {
		open: string | null;
		sealed?: string | null;
	} | null | {
		eq?: {
			open: string | null;
			sealed?: string | null;
		} | null;
		ne?: {
			open: string | null;
			sealed?: string | null;
		} | null;
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
	AND?: GatedFilter[];
	OR?: GatedFilter[];
	NOT?: GatedFilter;
}
export type GatedOrder = Partial<Record<"id" | "title" | "level" | "ownerId" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface Jotting {
	id: number;
	title: string;
	note: string | null;
	ownerId: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface JottingInsert {
	title: string;
	note?: string | null;
	ownerId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface JottingPatch {
	title?: string;
	note?: string | null;
	ownerId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface JottingWith {}
export interface JottingFilter {
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
	note?: string | null | {
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
	AND?: JottingFilter[];
	OR?: JottingFilter[];
	NOT?: JottingFilter;
}
export type JottingOrder = Partial<Record<"id" | "title" | "note" | "ownerId" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface Notice {
	id: number;
	title: string;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface NoticeInsert {
	title: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface NoticePatch {
	title?: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface NoticeWith {}
export interface NoticeFilter {
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
	AND?: NoticeFilter[];
	OR?: NoticeFilter[];
	NOT?: NoticeFilter;
}
export type NoticeOrder = Partial<Record<"id" | "title" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface Fuse {
	id: number;
	title: string;
	note: string | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface FuseInsert {
	title: string;
	note?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface FusePatch {
	title?: string;
	note?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface FuseWith {}
export interface FuseFilter {
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
	note?: string | null | {
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
	AND?: FuseFilter[];
	OR?: FuseFilter[];
	NOT?: FuseFilter;
}
export type FuseOrder = Partial<Record<"id" | "title" | "note" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface OracleRow {
	id: number;
	title: string;
	ownerId: number | null;
	code: string | null;
	badge?: number | null;
	publicBadge: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
	uid: string | null;
}
export interface OracleRowInsert {
	title: string;
	ownerId?: number | null;
	code?: string | null;
	badge?: number | null;
	publicBadge?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface OracleRowPatch {
	title?: string;
	ownerId?: number | null;
	code?: string | null;
	badge?: number | null;
	publicBadge?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface OracleRowWith {
	oracleRefs?: true | {
		where?: OracleRefFilter;
		orderBy?: OracleRefOrder;
		limit?: number;
		offset?: number;
		with?: OracleRefWith;
	};
	oracleSync?: true | {
		where?: OracleSyncFilter;
		orderBy?: OracleSyncOrder;
		limit?: number;
		offset?: number;
		with?: OracleSyncWith;
	};
	refDefaults?: true | {
		where?: RefDefaultFilter;
		orderBy?: RefDefaultOrder;
		limit?: number;
		offset?: number;
		with?: RefDefaultWith;
	};
}
export interface OracleRowFilter {
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
	code?: string | null | {
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
	badge?: number | null | {
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
	publicBadge?: number | null | {
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
	oracleRefs?: true | OracleRefFilter;
	oracleSync?: true | OracleSyncFilter;
	refDefaults?: true | RefDefaultFilter;
	AND?: OracleRowFilter[];
	OR?: OracleRowFilter[];
	NOT?: OracleRowFilter;
}
export type OracleRowOrder = Partial<Record<"id" | "title" | "ownerId" | "code" | "badge" | "publicBadge" | "status" | "publishedAt" | "uid", "asc" | "desc">> | string;
export interface OracleRef {
	id: number;
	title: string;
	rowId: number | null;
	alias: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface OracleRefInsert {
	title: string;
	rowId?: number | null;
	alias?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface OracleRefPatch {
	title?: string;
	rowId?: number | null;
	alias?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface OracleRefWith {
	rowId?: true | {
		where?: OracleRowFilter;
		orderBy?: OracleRowOrder;
		limit?: number;
		offset?: number;
		with?: OracleRowWith;
	};
}
export interface OracleRefFilter {
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
	rowId?: number | null | {
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
	} | OracleRowFilter;
	alias?: number | null | {
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
	AND?: OracleRefFilter[];
	OR?: OracleRefFilter[];
	NOT?: OracleRefFilter;
}
export type OracleRefOrder = Partial<Record<"id" | "title" | "rowId" | "alias" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface OracleSync {
	id: number;
	title: string;
	rowId: number | null;
	badgeId: number | null;
	publicBadgeId: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
	uid: string | null;
}
export interface OracleSyncInsert {
	title: string;
	rowId?: number | null;
	badgeId?: number | null;
	publicBadgeId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface OracleSyncPatch {
	title?: string;
	rowId?: number | null;
	badgeId?: number | null;
	publicBadgeId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface OracleSyncWith {
	rowId?: true | {
		where?: OracleRowFilter;
		orderBy?: OracleRowOrder;
		limit?: number;
		offset?: number;
		with?: OracleRowWith;
	};
}
export interface OracleSyncFilter {
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
	rowId?: number | null | {
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
	} | OracleRowFilter;
	badgeId?: number | null | {
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
	publicBadgeId?: number | null | {
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
	AND?: OracleSyncFilter[];
	OR?: OracleSyncFilter[];
	NOT?: OracleSyncFilter;
}
export type OracleSyncOrder = Partial<Record<"id" | "title" | "rowId" | "badgeId" | "publicBadgeId" | "status" | "publishedAt" | "uid", "asc" | "desc">> | string;
export interface OraclePeer {
	id: number;
	title: string;
	ownerId: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
	uid: string | null;
	locale: "en" | "de" | "fr";
	translations: Partial<Record<"en" | "de" | "fr", number>>;
}
export interface OraclePeerFields {
	title: string;
	ownerId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
	locale?: "en" | "de" | "fr";
	translationOf?: undefined;
}
export type OraclePeerInsert = OraclePeerFields | (Omit<OraclePeerFields, "ownerId" | "translationOf"> & Partial<Pick<OraclePeerFields, "ownerId">> & {
	translationOf: number;
});
export interface OraclePeerPatch {
	title?: string;
	ownerId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface OraclePeerWith {}
export interface OraclePeerFilter {
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
	locale?: "en" | "de" | "fr" | null | {
		eq?: "en" | "de" | "fr" | null;
		ne?: "en" | "de" | "fr" | null;
		gt?: "en" | "de" | "fr";
		gte?: "en" | "de" | "fr";
		lt?: "en" | "de" | "fr";
		lte?: "en" | "de" | "fr";
		in?: ("en" | "de" | "fr")[];
		notIn?: ("en" | "de" | "fr")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	AND?: OraclePeerFilter[];
	OR?: OraclePeerFilter[];
	NOT?: OraclePeerFilter;
}
export type OraclePeerOrder = Partial<Record<"id" | "title" | "ownerId" | "status" | "publishedAt" | "uid" | "locale", "asc" | "desc">> | string;
export interface OracleParent {
	id: number;
	title: string;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface OracleParentInsert {
	title: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface OracleParentPatch {
	title?: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface OracleParentWith {
	oracleKids?: true | {
		where?: OracleKidFilter;
		orderBy?: OracleKidOrder;
		limit?: number;
		offset?: number;
		with?: OracleKidWith;
	};
	mentees?: true | {
		where?: OracleKidFilter;
		orderBy?: OracleKidOrder;
		limit?: number;
		offset?: number;
		with?: OracleKidWith;
	};
}
export interface OracleParentFilter {
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
	oracleKids?: true | OracleKidFilter;
	mentees?: true | OracleKidFilter;
	AND?: OracleParentFilter[];
	OR?: OracleParentFilter[];
	NOT?: OracleParentFilter;
}
export type OracleParentOrder = Partial<Record<"id" | "title" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface OracleKid {
	id: number;
	title: string;
	parentId: number | null;
	mentors: number[] | null;
	oracleTopics: number[];
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface OracleKidInsert {
	title: string;
	parentId?: number | null;
	mentors?: number[] | null;
	oracleTopics?: number[];
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface OracleKidPatch {
	title?: string;
	parentId?: number | null;
	mentors?: number[] | null;
	oracleTopics?: number[];
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface OracleKidWith {
	parentId?: true | {
		where?: OracleParentFilter;
		orderBy?: OracleParentOrder;
		limit?: number;
		offset?: number;
		with?: OracleParentWith;
	};
	mentors?: true | {
		where?: OracleParentFilter;
		orderBy?: OracleParentOrder;
		limit?: number;
		offset?: number;
		with?: OracleParentWith;
	};
	oracleTopics?: true | {
		where?: OracleTopicFilter;
		orderBy?: OracleTopicOrder;
		limit?: number;
		offset?: number;
		with?: OracleTopicWith;
	};
	oracleGrand?: true | {
		where?: OracleGrandFilter;
		orderBy?: OracleGrandOrder;
		limit?: number;
		offset?: number;
		with?: OracleGrandWith;
	};
}
export interface OracleKidFilter {
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
	parentId?: number | null | {
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
	} | OracleParentFilter;
	mentors?: [] | {
		has?: number;
		eq?: [];
		NOT?: {
			has?: number;
		};
	} | true | false | OracleParentFilter;
	oracleTopics?: [] | {
		has?: number;
		eq?: [];
		NOT?: {
			has?: number;
		};
	} | true | false | OracleTopicFilter;
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
	oracleGrand?: true | OracleGrandFilter;
	AND?: OracleKidFilter[];
	OR?: OracleKidFilter[];
	NOT?: OracleKidFilter;
}
export type OracleKidOrder = Partial<Record<"id" | "title" | "parentId" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface OracleGrand {
	id: number;
	title: string;
	childId: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface OracleGrandInsert {
	title: string;
	childId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface OracleGrandPatch {
	title?: string;
	childId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface OracleGrandWith {
	childId?: true | {
		where?: OracleKidFilter;
		orderBy?: OracleKidOrder;
		limit?: number;
		offset?: number;
		with?: OracleKidWith;
	};
}
export interface OracleGrandFilter {
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
	childId?: number | null | {
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
	} | OracleKidFilter;
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
	AND?: OracleGrandFilter[];
	OR?: OracleGrandFilter[];
	NOT?: OracleGrandFilter;
}
export type OracleGrandOrder = Partial<Record<"id" | "title" | "childId" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface OracleDefault {
	id: number;
	title: string;
	code?: string | null;
	touched?: string | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface OracleDefaultInsert {
	title: string;
	code?: string | null;
	touched?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface OracleDefaultPatch {
	title?: string;
	code?: string | null;
	touched?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface OracleDefaultWith {}
export interface OracleDefaultFilter {
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
	code?: string | null | {
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
	touched?: string | null | {
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
	AND?: OracleDefaultFilter[];
	OR?: OracleDefaultFilter[];
	NOT?: OracleDefaultFilter;
}
export type OracleDefaultOrder = Partial<Record<"id" | "title" | "code" | "touched" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface NullParent {
	id: number;
	title: string;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface NullParentInsert {
	title: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface NullParentPatch {
	title?: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface NullParentWith {
	nullChildren?: true | {
		where?: NullChildrenFilter;
		orderBy?: NullChildrenOrder;
		limit?: number;
		offset?: number;
		with?: NullChildrenWith;
	};
}
export interface NullParentFilter {
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
	nullChildren?: true | NullChildrenFilter;
	AND?: NullParentFilter[];
	OR?: NullParentFilter[];
	NOT?: NullParentFilter;
}
export type NullParentOrder = Partial<Record<"id" | "title" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface NullChildren {
	id: number;
	title: string;
	parentId: number | null;
	code?: string | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface NullChildrenInsert {
	title: string;
	parentId?: number | null;
	code?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface NullChildrenPatch {
	title?: string;
	parentId?: number | null;
	code?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface NullChildrenWith {
	parentId?: true | {
		where?: NullParentFilter;
		orderBy?: NullParentOrder;
		limit?: number;
		offset?: number;
		with?: NullParentWith;
	};
}
export interface NullChildrenFilter {
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
	parentId?: number | null | {
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
	} | NullParentFilter;
	code?: string | null | {
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
	AND?: NullChildrenFilter[];
	OR?: NullChildrenFilter[];
	NOT?: NullChildrenFilter;
}
export type NullChildrenOrder = Partial<Record<"id" | "title" | "parentId" | "code" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface HookParent {
	id: number;
	title: string;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface HookParentInsert {
	title: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface HookParentPatch {
	title?: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface HookParentWith {
	hookChildren?: true | {
		where?: HookChildrenFilter;
		orderBy?: HookChildrenOrder;
		limit?: number;
		offset?: number;
		with?: HookChildrenWith;
	};
}
export interface HookParentFilter {
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
	hookChildren?: true | HookChildrenFilter;
	AND?: HookParentFilter[];
	OR?: HookParentFilter[];
	NOT?: HookParentFilter;
}
export type HookParentOrder = Partial<Record<"id" | "title" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface HookChildren {
	id: number;
	title: string;
	parentId: number | null;
	code?: string | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface HookChildrenInsert {
	title: string;
	parentId?: number | null;
	code?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface HookChildrenPatch {
	title?: string;
	parentId?: number | null;
	code?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface HookChildrenWith {
	parentId?: true | {
		where?: HookParentFilter;
		orderBy?: HookParentOrder;
		limit?: number;
		offset?: number;
		with?: HookParentWith;
	};
}
export interface HookChildrenFilter {
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
	parentId?: number | null | {
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
	} | HookParentFilter;
	code?: string | null | {
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
	AND?: HookChildrenFilter[];
	OR?: HookChildrenFilter[];
	NOT?: HookChildrenFilter;
}
export type HookChildrenOrder = Partial<Record<"id" | "title" | "parentId" | "code" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface SecretParent {
	id: number;
	title: string;
	secret?: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface SecretParentInsert {
	title: string;
	secret?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface SecretParentPatch {
	title?: string;
	secret?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface SecretParentWith {}
export interface SecretParentFilter {
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
	secret?: number | null | {
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
	AND?: SecretParentFilter[];
	OR?: SecretParentFilter[];
	NOT?: SecretParentFilter;
}
export type SecretParentOrder = Partial<Record<"id" | "title" | "secret" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface SecretLink {
	id: number;
	title: string;
	secret: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface SecretLinkInsert {
	title: string;
	secret?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface SecretLinkPatch {
	title?: string;
	secret?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface SecretLinkWith {}
export interface SecretLinkFilter {
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
	secret?: number | null | {
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
	AND?: SecretLinkFilter[];
	OR?: SecretLinkFilter[];
	NOT?: SecretLinkFilter;
}
export type SecretLinkOrder = Partial<Record<"id" | "title" | "secret" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface RefDefault {
	id: number;
	title: string;
	targetId: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface RefDefaultInsert {
	title: string;
	targetId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface RefDefaultPatch {
	title?: string;
	targetId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface RefDefaultWith {
	targetId?: true | {
		where?: OracleRowFilter;
		orderBy?: OracleRowOrder;
		limit?: number;
		offset?: number;
		with?: OracleRowWith;
	};
}
export interface RefDefaultFilter {
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
	targetId?: number | null | {
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
	} | OracleRowFilter;
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
	AND?: RefDefaultFilter[];
	OR?: RefDefaultFilter[];
	NOT?: RefDefaultFilter;
}
export type RefDefaultOrder = Partial<Record<"id" | "title" | "targetId" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface DefaultOnly {
	id: number;
	title: string;
	code?: string | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface DefaultOnlyInsert {
	title: string;
	code?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface DefaultOnlyPatch {
	title?: string;
	code?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface DefaultOnlyWith {}
export interface DefaultOnlyFilter {
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
	code?: string | null | {
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
	AND?: DefaultOnlyFilter[];
	OR?: DefaultOnlyFilter[];
	NOT?: DefaultOnlyFilter;
}
export type DefaultOnlyOrder = Partial<Record<"id" | "title" | "code" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface DerivedRef {
	id: number;
	title: string;
	badgeId: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
	uid: string | null;
}
export interface DerivedRefInsert {
	title: string;
	badgeId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface DerivedRefPatch {
	title?: string;
	badgeId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface DerivedRefWith {}
export interface DerivedRefFilter {
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
	badgeId?: number | null | {
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
	AND?: DerivedRefFilter[];
	OR?: DerivedRefFilter[];
	NOT?: DerivedRefFilter;
}
export type DerivedRefOrder = Partial<Record<"id" | "title" | "badgeId" | "status" | "publishedAt" | "uid", "asc" | "desc">> | string;
export interface DeepRoot {
	id: number;
	title: string;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface DeepRootInsert {
	title: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface DeepRootPatch {
	title?: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface DeepRootWith {
	deepNodes?: true | {
		where?: DeepNodeFilter;
		orderBy?: DeepNodeOrder;
		limit?: number;
		offset?: number;
		with?: DeepNodeWith;
	};
}
export interface DeepRootFilter {
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
	deepNodes?: true | DeepNodeFilter;
	AND?: DeepRootFilter[];
	OR?: DeepRootFilter[];
	NOT?: DeepRootFilter;
}
export type DeepRootOrder = Partial<Record<"id" | "title" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface DeepNode {
	id: number;
	title: string;
	rootId: number | null;
	parentId: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface DeepNodeInsert {
	title: string;
	rootId?: number | null;
	parentId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface DeepNodePatch {
	title?: string;
	rootId?: number | null;
	parentId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface DeepNodeWith {
	rootId?: true | {
		where?: DeepRootFilter;
		orderBy?: DeepRootOrder;
		limit?: number;
		offset?: number;
		with?: DeepRootWith;
	};
	parentId?: true | {
		where?: DeepNodeFilter;
		orderBy?: DeepNodeOrder;
		limit?: number;
		offset?: number;
		with?: DeepNodeWith;
	};
	deepNodes?: true | {
		where?: DeepNodeFilter;
		orderBy?: DeepNodeOrder;
		limit?: number;
		offset?: number;
		with?: DeepNodeWith;
	};
}
export interface DeepNodeFilter {
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
	rootId?: number | null | {
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
	} | DeepRootFilter;
	parentId?: number | null | {
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
	} | DeepNodeFilter;
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
	deepNodes?: true | DeepNodeFilter;
	AND?: DeepNodeFilter[];
	OR?: DeepNodeFilter[];
	NOT?: DeepNodeFilter;
}
export type DeepNodeOrder = Partial<Record<"id" | "title" | "rootId" | "parentId" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface RoundTrip {
	id: number;
	title: string;
	ownerId: number | null;
	slug: string | null;
	secretCode?: string | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
	uid: string | null;
}
export interface RoundTripInsert {
	title: string;
	ownerId?: number | null;
	slug?: string | null;
	secretCode?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface RoundTripPatch {
	title?: string;
	ownerId?: number | null;
	slug?: string | null;
	secretCode?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface RoundTripWith {}
export interface RoundTripFilter {
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
	secretCode?: string | null | {
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
	AND?: RoundTripFilter[];
	OR?: RoundTripFilter[];
	NOT?: RoundTripFilter;
}
export type RoundTripOrder = Partial<Record<"id" | "title" | "ownerId" | "slug" | "secretCode" | "status" | "publishedAt" | "uid", "asc" | "desc">> | string;
export interface Leg {
	id: number;
	title: string;
	tourId: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
	locale: "en" | "de" | "fr";
	translations: Partial<Record<"en" | "de" | "fr", number>>;
}
export interface LegFields {
	title: string;
	tourId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	locale?: "en" | "de" | "fr";
	translationOf?: undefined;
}
export type LegInsert = LegFields | (Omit<LegFields, "tourId" | "translationOf"> & Partial<Pick<LegFields, "tourId">> & {
	translationOf: number;
});
export interface LegPatch {
	title?: string;
	tourId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface LegWith {
	tourId?: true | {
		where?: TourFilter;
		orderBy?: TourOrder;
		limit?: number;
		offset?: number;
		with?: TourWith;
	};
}
export interface LegFilter {
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
	tourId?: number | null | {
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
	} | TourFilter;
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
	locale?: "en" | "de" | "fr" | null | {
		eq?: "en" | "de" | "fr" | null;
		ne?: "en" | "de" | "fr" | null;
		gt?: "en" | "de" | "fr";
		gte?: "en" | "de" | "fr";
		lt?: "en" | "de" | "fr";
		lte?: "en" | "de" | "fr";
		in?: ("en" | "de" | "fr")[];
		notIn?: ("en" | "de" | "fr")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	AND?: LegFilter[];
	OR?: LegFilter[];
	NOT?: LegFilter;
}
export type LegOrder = Partial<Record<"id" | "title" | "tourId" | "status" | "publishedAt" | "locale", "asc" | "desc">> | string;
export interface Bulletin {
	id: number;
	title: string;
	slug: string | null;
	body: string | null;
	summary: string | null;
	code: string | null;
	ownerId: number | null;
	memo?: string | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface BulletinInsert {
	title: string;
	slug?: string | null;
	body?: string | null;
	summary?: string | null;
	code?: string | null;
	ownerId?: number | null;
	memo?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface BulletinPatch {
	title?: string;
	slug?: string | null;
	body?: string | null;
	summary?: string | null;
	code?: string | null;
	ownerId?: number | null;
	memo?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface BulletinWith {}
export interface BulletinFilter {
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
	body?: string | null | {
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
	summary?: string | null | {
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
	code?: string | null | {
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
	memo?: string | null | {
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
	AND?: BulletinFilter[];
	OR?: BulletinFilter[];
	NOT?: BulletinFilter;
}
export type BulletinOrder = Partial<Record<"id" | "title" | "slug" | "body" | "summary" | "code" | "ownerId" | "memo" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface FixedNote {
	id: number;
	title: string;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
}
export interface FixedNoteInsert {
	title: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface FixedNotePatch {
	title?: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
}
export interface FixedNoteWith {}
export interface FixedNoteFilter {
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
	AND?: FixedNoteFilter[];
	OR?: FixedNoteFilter[];
	NOT?: FixedNoteFilter;
}
export type FixedNoteOrder = Partial<Record<"id" | "title" | "status" | "publishedAt", "asc" | "desc">> | string;
export interface Writer {
	id: number;
	name: string;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
	uid: string | null;
}
export interface WriterInsert {
	name: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface WriterPatch {
	name?: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface WriterWith {
	guides?: true | {
		where?: GuideFilter;
		orderBy?: GuideOrder;
		limit?: number;
		offset?: number;
		with?: GuideWith;
	};
}
export interface WriterFilter {
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
	guides?: true | GuideFilter;
	AND?: WriterFilter[];
	OR?: WriterFilter[];
	NOT?: WriterFilter;
}
export type WriterOrder = Partial<Record<"id" | "name" | "status" | "publishedAt" | "uid", "asc" | "desc">> | string;
export interface Guide {
	id: number;
	title: string;
	slug: string | null;
	body: string | null;
	summary: string | null;
	level: "intro" | "advanced" | null;
	writerId: number | null;
	internal?: string | null;
	review: string | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
	uid: string | null;
}
export interface GuideInsert {
	title: string;
	slug?: string | null;
	body?: string | null;
	summary?: string | null;
	level?: "intro" | "advanced" | null;
	writerId?: number | null;
	internal?: string | null;
	review?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface GuidePatch {
	title?: string;
	slug?: string | null;
	body?: string | null;
	summary?: string | null;
	level?: "intro" | "advanced" | null;
	writerId?: number | null;
	internal?: string | null;
	review?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface GuideWith {
	writerId?: true | {
		where?: WriterFilter;
		orderBy?: WriterOrder;
		limit?: number;
		offset?: number;
		with?: WriterWith;
	};
}
export interface GuideFilter {
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
	body?: string | null | {
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
	summary?: string | null | {
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
	level?: "intro" | "advanced" | null | {
		eq?: "intro" | "advanced" | null;
		ne?: "intro" | "advanced" | null;
		gt?: "intro" | "advanced";
		gte?: "intro" | "advanced";
		lt?: "intro" | "advanced";
		lte?: "intro" | "advanced";
		in?: ("intro" | "advanced")[];
		notIn?: ("intro" | "advanced")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	writerId?: number | null | {
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
	} | WriterFilter;
	internal?: string | null | {
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
	review?: string | null | {
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
	AND?: GuideFilter[];
	OR?: GuideFilter[];
	NOT?: GuideFilter;
}
export type GuideOrder = Partial<Record<"id" | "title" | "slug" | "body" | "summary" | "level" | "writerId" | "internal" | "review" | "status" | "publishedAt" | "uid", "asc" | "desc">> | string;
export interface Brief {
	id: number;
	title: string;
	body?: string | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
	uid: string | null;
}
export interface BriefInsert {
	title: string;
	body?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface BriefPatch {
	title?: string;
	body?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface BriefWith {}
export interface BriefFilter {
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
	body?: string | null | {
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
	AND?: BriefFilter[];
	OR?: BriefFilter[];
	NOT?: BriefFilter;
}
export type BriefOrder = Partial<Record<"id" | "title" | "body" | "status" | "publishedAt" | "uid", "asc" | "desc">> | string;
export interface Memo {
	id: number;
	title: string;
	body: string | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
	uid: string | null;
}
export interface MemoInsert {
	title: string;
	body?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface MemoPatch {
	title?: string;
	body?: string | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface MemoWith {}
export interface MemoFilter {
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
	body?: string | null | {
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
	AND?: MemoFilter[];
	OR?: MemoFilter[];
	NOT?: MemoFilter;
}
export type MemoOrder = Partial<Record<"id" | "title" | "body" | "status" | "publishedAt" | "uid", "asc" | "desc">> | string;
export interface Signup {
	id: number;
	email: string;
	postId: number | null;
	teamId: number | null;
}
export interface SignupInsert {
	email: string;
	postId?: number | null;
	teamId?: number | null;
}
export interface SignupPatch {
	email?: string;
	postId?: number | null;
	teamId?: number | null;
}
export interface SignupWith {
	postId?: true | {
		where?: PostFilter;
		orderBy?: PostOrder;
		limit?: number;
		offset?: number;
		with?: PostWith;
	};
	teamId?: true | {
		where?: FieldTeamFilter;
		orderBy?: FieldTeamOrder;
		limit?: number;
		offset?: number;
		with?: FieldTeamWith;
	};
}
export interface SignupFilter {
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
	postId?: number | null | {
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
	} | PostFilter;
	teamId?: number | null | {
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
	} | FieldTeamFilter;
	AND?: SignupFilter[];
	OR?: SignupFilter[];
	NOT?: SignupFilter;
}
export type SignupOrder = Partial<Record<"id" | "email" | "postId" | "teamId", "asc" | "desc">> | string;
export interface Comment {
	id: number;
	postId: number;
	name: string;
	body: string;
	approved: boolean;
	createdAt: string;
}
export interface CommentInsert {
	postId: number;
	name: string;
	body: string;
	approved?: boolean;
	createdAt?: string;
}
export interface CommentPatch {
	postId?: number;
	name?: string;
	body?: string;
	approved?: boolean;
	createdAt?: string;
}
export interface CommentWith {
	postId?: true | {
		where?: PostFilter;
		orderBy?: PostOrder;
		limit?: number;
		offset?: number;
		with?: PostWith;
	};
}
export interface CommentFilter {
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
	postId?: number | null | {
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
	} | PostFilter;
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
	body?: string | null | {
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
	approved?: boolean | null | {
		eq?: boolean | null;
		ne?: boolean | null;
		gt?: boolean;
		gte?: boolean;
		lt?: boolean;
		lte?: boolean;
		in?: boolean[];
		notIn?: boolean[];
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
	AND?: CommentFilter[];
	OR?: CommentFilter[];
	NOT?: CommentFilter;
}
export type CommentOrder = Partial<Record<"id" | "postId" | "name" | "body" | "approved" | "createdAt", "asc" | "desc">> | string;
export interface Guestbook {
	id: number;
	message: string;
	memberId: number | null;
}
export interface GuestbookInsert {
	message: string;
	memberId?: number | null;
}
export interface GuestbookPatch {
	message?: string;
	memberId?: number | null;
}
export interface GuestbookWith {
	memberId?: true | {
		where?: MemberFilter;
		orderBy?: MemberOrder;
		limit?: number;
		offset?: number;
		with?: MemberWith;
	};
	members?: true | {
		where?: MemberFilter;
		orderBy?: MemberOrder;
		limit?: number;
		offset?: number;
		with?: MemberWith;
	};
}
export interface GuestbookFilter {
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
	message?: string | null | {
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
	memberId?: number | null | {
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
	} | MemberFilter;
	members?: true | MemberFilter;
	AND?: GuestbookFilter[];
	OR?: GuestbookFilter[];
	NOT?: GuestbookFilter;
}
export type GuestbookOrder = Partial<Record<"id" | "message" | "memberId", "asc" | "desc">> | string;
export interface Review {
	id: number;
	body: string;
}
export interface ReviewInsert {
	body: string;
}
export interface ReviewPatch {
	body?: string;
}
export interface ReviewWith {}
export interface ReviewFilter {
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
	body?: string | null | {
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
	AND?: ReviewFilter[];
	OR?: ReviewFilter[];
	NOT?: ReviewFilter;
}
export type ReviewOrder = Partial<Record<"id" | "body", "asc" | "desc">> | string;
export interface MemberUpdate {
	id: number;
	memberId: number;
	name: string;
	city: string | null;
}
export interface MemberUpdateInsert {
	memberId: number;
	name: string;
	city?: string | null;
}
export interface MemberUpdatePatch {
	memberId?: number;
	name?: string;
	city?: string | null;
}
export interface MemberUpdateWith {}
export interface MemberUpdateFilter {
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
	memberId?: number | null | {
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
	city?: string | null | {
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
	AND?: MemberUpdateFilter[];
	OR?: MemberUpdateFilter[];
	NOT?: MemberUpdateFilter;
}
export type MemberUpdateOrder = Partial<Record<"id" | "memberId" | "name" | "city", "asc" | "desc">> | string;
export interface FieldTeam {
	id: number;
	name: string;
	budget?: number | null;
}
export interface FieldTeamInsert {
	name: string;
	budget?: number | null;
}
export interface FieldTeamPatch {
	name?: string;
	budget?: number | null;
}
export interface FieldTeamWith {
	fieldStaff?: true | {
		where?: FieldStaffFilter;
		orderBy?: FieldStaffOrder;
		limit?: number;
		offset?: number;
		with?: FieldStaffWith;
	};
	signups?: true | {
		where?: SignupFilter;
		orderBy?: SignupOrder;
		limit?: number;
		offset?: number;
		with?: SignupWith;
	};
}
export interface FieldTeamFilter {
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
	budget?: number | null | {
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
	fieldStaff?: true | FieldStaffFilter;
	signups?: true | SignupFilter;
	AND?: FieldTeamFilter[];
	OR?: FieldTeamFilter[];
	NOT?: FieldTeamFilter;
}
export type FieldTeamOrder = Partial<Record<"id" | "name" | "budget", "asc" | "desc">> | string;
export interface JobNote {
	id: number;
	title: string;
	fail: boolean;
	stamped: string | null;
}
export interface JobNoteInsert {
	title: string;
	fail?: boolean;
	stamped?: string | null;
}
export interface JobNotePatch {
	title?: string;
	fail?: boolean;
	stamped?: string | null;
}
export interface JobNoteWith {}
export interface JobNoteFilter {
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
	fail?: boolean | null | {
		eq?: boolean | null;
		ne?: boolean | null;
		gt?: boolean;
		gte?: boolean;
		lt?: boolean;
		lte?: boolean;
		in?: boolean[];
		notIn?: boolean[];
		isNull?: true;
		isNotNull?: true;
	};
	stamped?: string | null | {
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
	AND?: JobNoteFilter[];
	OR?: JobNoteFilter[];
	NOT?: JobNoteFilter;
}
export type JobNoteOrder = Partial<Record<"id" | "title" | "fail" | "stamped", "asc" | "desc">> | string;
export interface HookNote {
	id: number;
	title: string;
}
export interface HookNoteInsert {
	title: string;
}
export interface HookNotePatch {
	title?: string;
}
export interface HookNoteWith {}
export interface HookNoteFilter {
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
	AND?: HookNoteFilter[];
	OR?: HookNoteFilter[];
	NOT?: HookNoteFilter;
}
export type HookNoteOrder = Partial<Record<"id" | "title", "asc" | "desc">> | string;
export interface TourLog {
	id: number;
	tourId: number;
	entry: string;
}
export interface TourLogInsert {
	tourId: number;
	entry: string;
}
export interface TourLogPatch {
	tourId?: number;
	entry?: string;
}
export interface TourLogWith {}
export interface TourLogFilter {
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
	tourId?: number | null | {
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
	entry?: string | null | {
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
	AND?: TourLogFilter[];
	OR?: TourLogFilter[];
	NOT?: TourLogFilter;
}
export type TourLogOrder = Partial<Record<"id" | "tourId" | "entry", "asc" | "desc">> | string;
export interface Phrase {
	id: number;
	text: string;
	weight: number | null;
	locale: "en" | "de" | "fr";
	translations: Partial<Record<"en" | "de" | "fr", number>>;
}
export interface PhraseFields {
	text: string;
	weight?: number | null;
	locale?: "en" | "de" | "fr";
	translationOf?: undefined;
}
export type PhraseInsert = PhraseFields | (Omit<PhraseFields, "weight" | "translationOf"> & Partial<Pick<PhraseFields, "weight">> & {
	translationOf: number;
});
export interface PhrasePatch {
	text?: string;
	weight?: number | null;
}
export interface PhraseWith {}
export interface PhraseFilter {
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
	text?: string | null | {
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
	weight?: number | null | {
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
	locale?: "en" | "de" | "fr" | null | {
		eq?: "en" | "de" | "fr" | null;
		ne?: "en" | "de" | "fr" | null;
		gt?: "en" | "de" | "fr";
		gte?: "en" | "de" | "fr";
		lt?: "en" | "de" | "fr";
		lte?: "en" | "de" | "fr";
		in?: ("en" | "de" | "fr")[];
		notIn?: ("en" | "de" | "fr")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	AND?: PhraseFilter[];
	OR?: PhraseFilter[];
	NOT?: PhraseFilter;
}
export type PhraseOrder = Partial<Record<"id" | "text" | "weight" | "locale", "asc" | "desc">> | string;
export interface UploadRecord {
	id: number;
	deck: number | null;
	image: number | null;
}
export interface UploadRecordInsert {
	deck?: number | null;
	image?: number | null;
}
export interface UploadRecordPatch {
	deck?: number | null;
	image?: number | null;
}
export interface UploadRecordWith {
	deck?: true;
	image?: true;
}
export interface UploadRecordFilter {
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
	deck?: number | null | {
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
	image?: number | null | {
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
	AND?: UploadRecordFilter[];
	OR?: UploadRecordFilter[];
	NOT?: UploadRecordFilter;
}
export type UploadRecordOrder = Partial<Record<"id" | "deck" | "image", "asc" | "desc">> | string;
export interface FuseLog {
	id: number;
	msg: string;
}
export interface FuseLogInsert {
	msg: string;
}
export interface FuseLogPatch {
	msg?: string;
}
export interface FuseLogWith {}
export interface FuseLogFilter {
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
	msg?: string | null | {
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
	AND?: FuseLogFilter[];
	OR?: FuseLogFilter[];
	NOT?: FuseLogFilter;
}
export type FuseLogOrder = Partial<Record<"id" | "msg", "asc" | "desc">> | string;
export interface GuestCart {
	id: number;
	memberId: number;
}
export interface GuestCartInsert {
	memberId: number;
}
export interface GuestCartPatch {
	memberId?: number;
}
export interface GuestCartWith {
	memberId?: true | {
		where?: MemberFilter;
		orderBy?: MemberOrder;
		limit?: number;
		offset?: number;
		with?: MemberWith;
	};
}
export interface GuestCartFilter {
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
	memberId?: number | null | {
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
	} | MemberFilter;
	AND?: GuestCartFilter[];
	OR?: GuestCartFilter[];
	NOT?: GuestCartFilter;
}
export type GuestCartOrder = Partial<Record<"id" | "memberId", "asc" | "desc">> | string;
export interface GuestNote {
	id: number;
	body: string;
	memberId: number | null;
}
export interface GuestNoteInsert {
	body: string;
	memberId?: number | null;
}
export interface GuestNotePatch {
	body?: string;
	memberId?: number | null;
}
export interface GuestNoteWith {
	memberId?: true | {
		where?: MemberFilter;
		orderBy?: MemberOrder;
		limit?: number;
		offset?: number;
		with?: MemberWith;
	};
}
export interface GuestNoteFilter {
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
	body?: string | null | {
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
	memberId?: number | null | {
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
	} | MemberFilter;
	AND?: GuestNoteFilter[];
	OR?: GuestNoteFilter[];
	NOT?: GuestNoteFilter;
}
export type GuestNoteOrder = Partial<Record<"id" | "body" | "memberId", "asc" | "desc">> | string;
export interface BigCount {
	id: number;
	n: number;
}
export interface BigCountInsert {
	n: number;
}
export interface BigCountPatch {
	n?: number;
}
export interface BigCountWith {}
export interface BigCountFilter {
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
	n?: number | null | {
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
	AND?: BigCountFilter[];
	OR?: BigCountFilter[];
	NOT?: BigCountFilter;
}
export type BigCountOrder = Partial<Record<"id" | "n", "asc" | "desc">> | string;
export interface BulletinLog {
	id: number;
	bulletinId: number;
	change: string;
	by: string;
}
export interface BulletinLogInsert {
	bulletinId: number;
	change: string;
	by: string;
}
export interface BulletinLogPatch {
	bulletinId?: number;
	change?: string;
	by?: string;
}
export interface BulletinLogWith {}
export interface BulletinLogFilter {
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
	bulletinId?: number | null | {
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
	change?: string | null | {
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
	by?: string | null | {
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
	AND?: BulletinLogFilter[];
	OR?: BulletinLogFilter[];
	NOT?: BulletinLogFilter;
}
export type BulletinLogOrder = Partial<Record<"id" | "bulletinId" | "change" | "by", "asc" | "desc">> | string;
export interface Member {
	id: number;
	email: string;
	name: string;
	plan: "free" | "pro";
	points: number;
	tags: ("early" | "beta")[];
	handle: string | null;
	joined: string | null;
	perk: string | null;
	badge: string | null;
	sponsorId: number | null;
	sponsored: string | null;
	address: {
		city: string | null;
		source: string;
		defaults: {
			clock: {
				at: string | null;
			} | null;
		} | null;
		channel: string;
		since: string;
		verified: boolean;
		optional: boolean | null;
		prefs: {
			bio: string | null;
		} | null;
		district: string | null;
	} | null;
	links: {
		label: string;
		at: string | null;
		detail: string;
		metadata: {
			bio: string | null;
		};
	}[] | null;
	sections: ({
		layout: "bio";
		body: string;
	} | {
		layout: "quote";
		text: string | null;
		cite: string | null;
	})[] | null;
	notes: {
		private?: string | null;
	} | null;
	addressBy: number | null;
	role: "guest" | "subscriber" | "author" | "editor" | "admin";
}
export interface MemberInsert {
	email: string;
	name: string;
	plan?: "free" | "pro";
	points?: number;
	tags?: ("early" | "beta")[];
	handle?: string | null;
	joined?: string | null;
	perk?: string | null;
	badge?: string | null;
	sponsorId?: number | null;
	sponsored?: string | null;
	address?: {
		city?: string | null;
		source?: string;
		defaults?: {
			clock?: {
				at?: string | null;
			} | null;
		} | null;
		channel?: string;
		since?: string;
		verified?: boolean;
		optional?: boolean | null;
		prefs?: {
			bio?: string | null;
		} | null;
		district?: string | null;
	} | null;
	links?: {
		label: string;
		at?: string | null;
		detail: string;
		metadata: {
			bio?: string | null;
		};
	}[] | null;
	sections?: ({
		layout: "bio";
		body: string;
	} | {
		layout: "quote";
		text?: string | null;
		cite?: string | null;
	})[] | null;
	notes?: {
		private?: string | null;
	} | null;
	addressBy?: number | null;
	role?: "guest" | "subscriber" | "author" | "editor" | "admin";
	password?: string;
}
export interface MemberPatch {
	email?: string;
	name?: string;
	plan?: "free" | "pro";
	points?: number;
	tags?: ("early" | "beta")[];
	handle?: string | null;
	joined?: string | null;
	perk?: string | null;
	badge?: string | null;
	sponsorId?: number | null;
	sponsored?: string | null;
	address?: {
		city?: string | null;
		source?: string;
		defaults?: {
			clock?: {
				at?: string | null;
			} | null;
		} | null;
		channel?: string;
		since?: string;
		verified?: boolean;
		optional?: boolean | null;
		prefs?: {
			bio?: string | null;
		} | null;
		district?: string | null;
	} | null;
	links?: {
		label: string;
		at?: string | null;
		detail: string;
		metadata: {
			bio?: string | null;
		};
	}[] | null;
	sections?: ({
		layout: "bio";
		body: string;
	} | {
		layout: "quote";
		text?: string | null;
		cite?: string | null;
	})[] | null;
	notes?: {
		private?: string | null;
	} | null;
	addressBy?: number | null;
	role?: "guest" | "subscriber" | "author" | "editor" | "admin";
	password?: string;
}
export interface MemberWith {
	sponsorId?: true | {
		where?: GuestbookFilter;
		orderBy?: GuestbookOrder;
		limit?: number;
		offset?: number;
		with?: GuestbookWith;
	};
	guestbook?: true | {
		where?: GuestbookFilter;
		orderBy?: GuestbookOrder;
		limit?: number;
		offset?: number;
		with?: GuestbookWith;
	};
	guestCarts?: true | {
		where?: GuestCartFilter;
		orderBy?: GuestCartOrder;
		limit?: number;
		offset?: number;
		with?: GuestCartWith;
	};
	guestNotes?: true | {
		where?: GuestNoteFilter;
		orderBy?: GuestNoteOrder;
		limit?: number;
		offset?: number;
		with?: GuestNoteWith;
	};
}
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
	plan?: "free" | "pro" | null | {
		eq?: "free" | "pro" | null;
		ne?: "free" | "pro" | null;
		gt?: "free" | "pro";
		gte?: "free" | "pro";
		lt?: "free" | "pro";
		lte?: "free" | "pro";
		in?: ("free" | "pro")[];
		notIn?: ("free" | "pro")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	points?: number | null | {
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
	tags?: [] | null | {
		has?: "early" | "beta";
		eq?: [];
		isNull?: true;
		isNotNull?: true;
	};
	handle?: string | null | {
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
	joined?: string | null | {
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
	perk?: string | null | {
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
	badge?: string | null | {
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
	sponsorId?: number | null | {
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
	} | GuestbookFilter;
	sponsored?: string | null | {
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
	address?: {
		city: string | null;
		source: string;
		defaults: {
			clock: {
				at: string | null;
			} | null;
		} | null;
		channel: string;
		since: string;
		verified: boolean;
		optional: boolean | null;
		prefs: {
			bio: string | null;
		} | null;
		district: string | null;
	} | null | {
		eq?: {
			city: string | null;
			source: string;
			defaults: {
				clock: {
					at: string | null;
				} | null;
			} | null;
			channel: string;
			since: string;
			verified: boolean;
			optional: boolean | null;
			prefs: {
				bio: string | null;
			} | null;
			district: string | null;
		} | null;
		ne?: {
			city: string | null;
			source: string;
			defaults: {
				clock: {
					at: string | null;
				} | null;
			} | null;
			channel: string;
			since: string;
			verified: boolean;
			optional: boolean | null;
			prefs: {
				bio: string | null;
			} | null;
			district: string | null;
		} | null;
		isNull?: true;
		isNotNull?: true;
	};
	links?: {
		label: string;
		at: string | null;
		detail: string;
		metadata: {
			bio: string | null;
		};
	}[] | null | {
		eq?: {
			label: string;
			at: string | null;
			detail: string;
			metadata: {
				bio: string | null;
			};
		}[] | null;
		ne?: {
			label: string;
			at: string | null;
			detail: string;
			metadata: {
				bio: string | null;
			};
		}[] | null;
		isNull?: true;
		isNotNull?: true;
	};
	sections?: ({
		layout: "bio";
		body: string;
	} | {
		layout: "quote";
		text: string | null;
		cite: string | null;
	})[] | null | {
		eq?: ({
			layout: "bio";
			body: string;
		} | {
			layout: "quote";
			text: string | null;
			cite: string | null;
		})[] | null;
		ne?: ({
			layout: "bio";
			body: string;
		} | {
			layout: "quote";
			text: string | null;
			cite: string | null;
		})[] | null;
		isNull?: true;
		isNotNull?: true;
	};
	notes?: {
		private?: string | null;
	} | null | {
		eq?: {
			private?: string | null;
		} | null;
		ne?: {
			private?: string | null;
		} | null;
		isNull?: true;
		isNotNull?: true;
	};
	addressBy?: number | null | {
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
	guestbook?: true | GuestbookFilter;
	guestCarts?: true | GuestCartFilter;
	guestNotes?: true | GuestNoteFilter;
	AND?: MemberFilter[];
	OR?: MemberFilter[];
	NOT?: MemberFilter;
}
export type MemberOrder = Partial<Record<"id" | "email" | "name" | "plan" | "points" | "handle" | "joined" | "perk" | "badge" | "sponsorId" | "sponsored" | "addressBy" | "role", "asc" | "desc">> | string;
export interface OracleTopic {
	id: number;
	name: string;
	slug: string;
	description: string;
	parent: number | null;
	count: number;
	url: string | null;
	color: string | null;
}
export interface OracleTopicInsert {
	name: string;
	slug?: string;
	description?: string;
	parent?: number | null;
	color?: string | null;
}
export interface OracleTopicPatch {
	name?: string;
	slug?: string;
	description?: string;
	parent?: number | null;
	color?: string | null;
}
export interface OracleTopicWith {
	oracleKids?: true | {
		where?: OracleKidFilter;
		orderBy?: OracleKidOrder;
		limit?: number;
		offset?: number;
		with?: OracleKidWith;
	};
}
export interface OracleTopicFilter {
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
	oracleKids?: true | OracleKidFilter;
	AND?: OracleTopicFilter[];
	OR?: OracleTopicFilter[];
	NOT?: OracleTopicFilter;
}
export type OracleTopicOrder = Partial<Record<"id" | "name" | "slug" | "description" | "parent" | "count" | "url" | "color", "asc" | "desc">> | string;
export interface Settings {
	siteTitle: string;
	tagline: string | null;
	postsPerPage: number;
	social: {
		label: string;
		href: string;
	}[] | null;
}
export interface SettingsPatch {
	siteTitle?: string;
	tagline?: string | null;
	postsPerPage?: number;
	social?: {
		label: string;
		href: string;
	}[] | null;
}
export type BumpPostsPerPageInput = Record<string, never>;
export type BumpPostsPerPageOutput = [number, number];
export interface ApproveCommentInput {
	id: number;
}
export type ApproveCommentOutput = Comment;
export type PublishedCountInput = Record<string, never>;
export type PublishedCountOutput = {
	count: number;
};
export interface RefsCountInput {
	body: string;
}
export type RefsCountOutput = {
	body: string;
	count: number;
	ids: number[];
};
export interface RefsPurgeInput {
	body: string;
}
export type RefsPurgeOutput = number;
export interface RefsRatioInput {
	n: number;
}
export type RefsRatioOutput = {
	ratio: number;
	big: 100000000000000000000;
	huge: number;
};
export type RefsEmptyInput = Record<string, never>;
export type RefsEmptyOutput = {};
export type RefsWireInput = Record<string, never>;
export type RefsWireOutput = {
	f?: never;
	a: [null, number];
};
export interface RefsEchoInput {
	meta?: unknown | null;
	info?: {
		tag?: string | null;
	} | null;
	items?: {
		tag?: string | null;
	}[] | null;
}
export type RefsEchoOutput = {
	meta?: unknown | null;
	info: {
		tag: string | null;
	};
} | {
	meta?: unknown | null;
};
export interface AgentNoteInput {
	note: string;
}
export type AgentNoteOutput = {
	note: string;
	seen: number;
};
export interface RefsEnqueueInput {
	noteId: number;
	meta: unknown;
}
export type RefsEnqueueOutput = {
	id: string;
	sent?: string;
};
export interface JobsOnceInput {
	note: string;
}
export type JobsOnceOutput = {
	ids: number[];
	f?: never;
};
export interface JobsTwiceInput {
	note: string;
}
export type JobsTwiceOutput = {
	a?: unknown;
	b?: unknown;
};
export interface JobsInboundInput {
	title: string;
}
export type JobsInboundOutput = {
	user: {
		id: number;
		name: string;
		role: "guest" | "subscriber" | "author" | "editor" | "admin";
	} | null;
};
export interface RefsTranslationsInput {
	id: number;
}
export type RefsTranslationsOutput = string[];
export interface JotQueryInput {
	tag: string;
}
export type JotQueryOutput = {
	titles: string[];
	statuses: ("draft" | "published" | "scheduled")[];
	pages: [string[], null | string[], null | string];
	total: number;
	searched: number;
	get: null | string;
	trusted: number;
	trustedCount: number;
};
export interface JotWriteInput {
	tag: string;
	step: string;
}
export type JotWriteOutput = string | "missing" | "none" | "unknown step";
export interface VaultPeekInput {
	title: string;
	system?: number | null;
}
export type VaultPeekOutput = string | null | {
	system: null | string;
	count: number;
};
export interface NativeHandlerInput {
	title: string;
	count: number;
}
export type NativeHandlerOutput = {
	title: string;
	count: number;
};
export interface BigMathInput {
	id: number;
	m: number;
}
export type BigMathOutput = null | (number | string | null)[];
export interface BulkTourPriceInput {
	a: number;
	b: number;
	price: number;
}
export type BulkTourPriceOutput = number;
export interface Collections {
	events: {
		row: Event;
		insert: EventInsert;
		patch: EventPatch;
		with: EventWith;
		filter: EventFilter;
		order: EventOrder;
	};
	authors: {
		row: Author;
		insert: AuthorInsert;
		patch: AuthorPatch;
		with: AuthorWith;
		filter: AuthorFilter;
		order: AuthorOrder;
	};
	posts: {
		row: Post;
		insert: PostInsert;
		patch: PostPatch;
		with: PostWith;
		filter: PostFilter;
		order: PostOrder;
	};
	fieldStaff: {
		row: FieldStaff;
		insert: FieldStaffInsert;
		patch: FieldStaffPatch;
		with: FieldStaffWith;
		filter: FieldStaffFilter;
		order: FieldStaffOrder;
	};
	tours: {
		row: Tour;
		insert: TourInsert;
		patch: TourPatch;
		with: TourWith;
		filter: TourFilter;
		order: TourOrder;
	};
	talks: {
		row: Talk;
		insert: TalkInsert;
		patch: TalkPatch;
		with: TalkWith;
		filter: TalkFilter;
		order: TalkOrder;
	};
	vault: {
		row: Vault;
		insert: VaultInsert;
		patch: VaultPatch;
		with: VaultWith;
		filter: VaultFilter;
		order: VaultOrder;
	};
	ledger: {
		row: Ledger;
		insert: LedgerInsert;
		patch: LedgerPatch;
		with: LedgerWith;
		filter: LedgerFilter;
		order: LedgerOrder;
	};
	payroll: {
		row: Payroll;
		insert: PayrollInsert;
		patch: PayrollPatch;
		with: PayrollWith;
		filter: PayrollFilter;
		order: PayrollOrder;
	};
	dossier: {
		row: Dossier;
		insert: DossierInsert;
		patch: DossierPatch;
		with: DossierWith;
		filter: DossierFilter;
		order: DossierOrder;
	};
	claims: {
		row: Claim;
		insert: ClaimInsert;
		patch: ClaimPatch;
		with: ClaimWith;
		filter: ClaimFilter;
		order: ClaimOrder;
	};
	gated: {
		row: Gated;
		insert: GatedInsert;
		patch: GatedPatch;
		with: GatedWith;
		filter: GatedFilter;
		order: GatedOrder;
	};
	jottings: {
		row: Jotting;
		insert: JottingInsert;
		patch: JottingPatch;
		with: JottingWith;
		filter: JottingFilter;
		order: JottingOrder;
	};
	notices: {
		row: Notice;
		insert: NoticeInsert;
		patch: NoticePatch;
		with: NoticeWith;
		filter: NoticeFilter;
		order: NoticeOrder;
	};
	fuses: {
		row: Fuse;
		insert: FuseInsert;
		patch: FusePatch;
		with: FuseWith;
		filter: FuseFilter;
		order: FuseOrder;
	};
	oracleRows: {
		row: OracleRow;
		insert: OracleRowInsert;
		patch: OracleRowPatch;
		with: OracleRowWith;
		filter: OracleRowFilter;
		order: OracleRowOrder;
	};
	oracleRefs: {
		row: OracleRef;
		insert: OracleRefInsert;
		patch: OracleRefPatch;
		with: OracleRefWith;
		filter: OracleRefFilter;
		order: OracleRefOrder;
	};
	oracleSync: {
		row: OracleSync;
		insert: OracleSyncInsert;
		patch: OracleSyncPatch;
		with: OracleSyncWith;
		filter: OracleSyncFilter;
		order: OracleSyncOrder;
	};
	oraclePeers: {
		row: OraclePeer;
		insert: OraclePeerInsert;
		patch: OraclePeerPatch;
		with: OraclePeerWith;
		filter: OraclePeerFilter;
		order: OraclePeerOrder;
	};
	oracleParents: {
		row: OracleParent;
		insert: OracleParentInsert;
		patch: OracleParentPatch;
		with: OracleParentWith;
		filter: OracleParentFilter;
		order: OracleParentOrder;
	};
	oracleKids: {
		row: OracleKid;
		insert: OracleKidInsert;
		patch: OracleKidPatch;
		with: OracleKidWith;
		filter: OracleKidFilter;
		order: OracleKidOrder;
	};
	oracleGrand: {
		row: OracleGrand;
		insert: OracleGrandInsert;
		patch: OracleGrandPatch;
		with: OracleGrandWith;
		filter: OracleGrandFilter;
		order: OracleGrandOrder;
	};
	oracleDefault: {
		row: OracleDefault;
		insert: OracleDefaultInsert;
		patch: OracleDefaultPatch;
		with: OracleDefaultWith;
		filter: OracleDefaultFilter;
		order: OracleDefaultOrder;
	};
	nullParents: {
		row: NullParent;
		insert: NullParentInsert;
		patch: NullParentPatch;
		with: NullParentWith;
		filter: NullParentFilter;
		order: NullParentOrder;
	};
	nullChildren: {
		row: NullChildren;
		insert: NullChildrenInsert;
		patch: NullChildrenPatch;
		with: NullChildrenWith;
		filter: NullChildrenFilter;
		order: NullChildrenOrder;
	};
	hookParents: {
		row: HookParent;
		insert: HookParentInsert;
		patch: HookParentPatch;
		with: HookParentWith;
		filter: HookParentFilter;
		order: HookParentOrder;
	};
	hookChildren: {
		row: HookChildren;
		insert: HookChildrenInsert;
		patch: HookChildrenPatch;
		with: HookChildrenWith;
		filter: HookChildrenFilter;
		order: HookChildrenOrder;
	};
	secretParents: {
		row: SecretParent;
		insert: SecretParentInsert;
		patch: SecretParentPatch;
		with: SecretParentWith;
		filter: SecretParentFilter;
		order: SecretParentOrder;
	};
	secretLinks: {
		row: SecretLink;
		insert: SecretLinkInsert;
		patch: SecretLinkPatch;
		with: SecretLinkWith;
		filter: SecretLinkFilter;
		order: SecretLinkOrder;
	};
	refDefaults: {
		row: RefDefault;
		insert: RefDefaultInsert;
		patch: RefDefaultPatch;
		with: RefDefaultWith;
		filter: RefDefaultFilter;
		order: RefDefaultOrder;
	};
	defaultOnly: {
		row: DefaultOnly;
		insert: DefaultOnlyInsert;
		patch: DefaultOnlyPatch;
		with: DefaultOnlyWith;
		filter: DefaultOnlyFilter;
		order: DefaultOnlyOrder;
	};
	derivedRefs: {
		row: DerivedRef;
		insert: DerivedRefInsert;
		patch: DerivedRefPatch;
		with: DerivedRefWith;
		filter: DerivedRefFilter;
		order: DerivedRefOrder;
	};
	deepRoots: {
		row: DeepRoot;
		insert: DeepRootInsert;
		patch: DeepRootPatch;
		with: DeepRootWith;
		filter: DeepRootFilter;
		order: DeepRootOrder;
	};
	deepNodes: {
		row: DeepNode;
		insert: DeepNodeInsert;
		patch: DeepNodePatch;
		with: DeepNodeWith;
		filter: DeepNodeFilter;
		order: DeepNodeOrder;
	};
	roundTrips: {
		row: RoundTrip;
		insert: RoundTripInsert;
		patch: RoundTripPatch;
		with: RoundTripWith;
		filter: RoundTripFilter;
		order: RoundTripOrder;
	};
	legs: {
		row: Leg;
		insert: LegInsert;
		patch: LegPatch;
		with: LegWith;
		filter: LegFilter;
		order: LegOrder;
	};
	bulletins: {
		row: Bulletin;
		insert: BulletinInsert;
		patch: BulletinPatch;
		with: BulletinWith;
		filter: BulletinFilter;
		order: BulletinOrder;
	};
	fixedNotes: {
		row: FixedNote;
		insert: FixedNoteInsert;
		patch: FixedNotePatch;
		with: FixedNoteWith;
		filter: FixedNoteFilter;
		order: FixedNoteOrder;
	};
	writers: {
		row: Writer;
		insert: WriterInsert;
		patch: WriterPatch;
		with: WriterWith;
		filter: WriterFilter;
		order: WriterOrder;
	};
	guides: {
		row: Guide;
		insert: GuideInsert;
		patch: GuidePatch;
		with: GuideWith;
		filter: GuideFilter;
		order: GuideOrder;
	};
	briefs: {
		row: Brief;
		insert: BriefInsert;
		patch: BriefPatch;
		with: BriefWith;
		filter: BriefFilter;
		order: BriefOrder;
	};
	memos: {
		row: Memo;
		insert: MemoInsert;
		patch: MemoPatch;
		with: MemoWith;
		filter: MemoFilter;
		order: MemoOrder;
	};
	signups: {
		row: Signup;
		insert: SignupInsert;
		patch: SignupPatch;
		with: SignupWith;
		filter: SignupFilter;
		order: SignupOrder;
	};
	comments: {
		row: Comment;
		insert: CommentInsert;
		patch: CommentPatch;
		with: CommentWith;
		filter: CommentFilter;
		order: CommentOrder;
	};
	guestbook: {
		row: Guestbook;
		insert: GuestbookInsert;
		patch: GuestbookPatch;
		with: GuestbookWith;
		filter: GuestbookFilter;
		order: GuestbookOrder;
	};
	reviews: {
		row: Review;
		insert: ReviewInsert;
		patch: ReviewPatch;
		with: ReviewWith;
		filter: ReviewFilter;
		order: ReviewOrder;
	};
	memberUpdates: {
		row: MemberUpdate;
		insert: MemberUpdateInsert;
		patch: MemberUpdatePatch;
		with: MemberUpdateWith;
		filter: MemberUpdateFilter;
		order: MemberUpdateOrder;
	};
	fieldTeams: {
		row: FieldTeam;
		insert: FieldTeamInsert;
		patch: FieldTeamPatch;
		with: FieldTeamWith;
		filter: FieldTeamFilter;
		order: FieldTeamOrder;
	};
	jobNotes: {
		row: JobNote;
		insert: JobNoteInsert;
		patch: JobNotePatch;
		with: JobNoteWith;
		filter: JobNoteFilter;
		order: JobNoteOrder;
	};
	hookNotes: {
		row: HookNote;
		insert: HookNoteInsert;
		patch: HookNotePatch;
		with: HookNoteWith;
		filter: HookNoteFilter;
		order: HookNoteOrder;
	};
	tourLog: {
		row: TourLog;
		insert: TourLogInsert;
		patch: TourLogPatch;
		with: TourLogWith;
		filter: TourLogFilter;
		order: TourLogOrder;
	};
	phrases: {
		row: Phrase;
		insert: PhraseInsert;
		patch: PhrasePatch;
		with: PhraseWith;
		filter: PhraseFilter;
		order: PhraseOrder;
	};
	uploadRecords: {
		row: UploadRecord;
		insert: UploadRecordInsert;
		patch: UploadRecordPatch;
		with: UploadRecordWith;
		filter: UploadRecordFilter;
		order: UploadRecordOrder;
	};
	fuseLog: {
		row: FuseLog;
		insert: FuseLogInsert;
		patch: FuseLogPatch;
		with: FuseLogWith;
		filter: FuseLogFilter;
		order: FuseLogOrder;
	};
	guestCarts: {
		row: GuestCart;
		insert: GuestCartInsert;
		patch: GuestCartPatch;
		with: GuestCartWith;
		filter: GuestCartFilter;
		order: GuestCartOrder;
	};
	guestNotes: {
		row: GuestNote;
		insert: GuestNoteInsert;
		patch: GuestNotePatch;
		with: GuestNoteWith;
		filter: GuestNoteFilter;
		order: GuestNoteOrder;
	};
	bigCounts: {
		row: BigCount;
		insert: BigCountInsert;
		patch: BigCountPatch;
		with: BigCountWith;
		filter: BigCountFilter;
		order: BigCountOrder;
	};
	bulletinLog: {
		row: BulletinLog;
		insert: BulletinLogInsert;
		patch: BulletinLogPatch;
		with: BulletinLogWith;
		filter: BulletinLogFilter;
		order: BulletinLogOrder;
	};
	members: {
		row: Member;
		insert: MemberInsert;
		patch: MemberPatch;
		with: MemberWith;
		filter: MemberFilter;
		order: MemberOrder;
	};
	oracleTopics: {
		row: OracleTopic;
		insert: OracleTopicInsert;
		patch: OracleTopicPatch;
		with: OracleTopicWith;
		filter: OracleTopicFilter;
		order: OracleTopicOrder;
	};
}
export interface Globals {
	settings: {
		row: Settings;
		patch: SettingsPatch;
	};
}
export interface Actions {
	bumpPostsPerPage: {
		input: BumpPostsPerPageInput;
		output: BumpPostsPerPageOutput;
	};
	approveComment: {
		input: ApproveCommentInput;
		output: ApproveCommentOutput;
	};
	publishedCount: {
		input: PublishedCountInput;
		output: PublishedCountOutput;
	};
	refsCount: {
		input: RefsCountInput;
		output: RefsCountOutput;
	};
	refsPurge: {
		input: RefsPurgeInput;
		output: RefsPurgeOutput;
	};
	refsRatio: {
		input: RefsRatioInput;
		output: RefsRatioOutput;
	};
	refsEmpty: {
		input: RefsEmptyInput;
		output: RefsEmptyOutput;
	};
	refsWire: {
		input: RefsWireInput;
		output: RefsWireOutput;
	};
	refsEcho: {
		input: RefsEchoInput;
		output: RefsEchoOutput;
	};
	agentNote: {
		input: AgentNoteInput;
		output: AgentNoteOutput;
	};
	refsEnqueue: {
		input: RefsEnqueueInput;
		output: RefsEnqueueOutput;
	};
	jobsOnce: {
		input: JobsOnceInput;
		output: JobsOnceOutput;
	};
	jobsTwice: {
		input: JobsTwiceInput;
		output: JobsTwiceOutput;
	};
	jobsInbound: {
		input: JobsInboundInput;
		output: JobsInboundOutput;
	};
	refsTranslations: {
		input: RefsTranslationsInput;
		output: RefsTranslationsOutput;
	};
	jotQuery: {
		input: JotQueryInput;
		output: JotQueryOutput;
	};
	jotWrite: {
		input: JotWriteInput;
		output: JotWriteOutput;
	};
	vaultPeek: {
		input: VaultPeekInput;
		output: VaultPeekOutput;
	};
	nativeHandler: {
		input: NativeHandlerInput;
		output: NativeHandlerOutput;
	};
	bigMath: {
		input: BigMathInput;
		output: BigMathOutput;
	};
	bulkTourPrice: {
		input: BulkTourPriceInput;
		output: BulkTourPriceOutput;
	};
}
export declare const SCHEMA: {
	readonly name: "blog";
	readonly collections: {
		readonly events: {
			readonly path: "events";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly postId: {
					readonly kind: "one";
					readonly collection: "posts";
					readonly optional: true;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly authors: {
			readonly path: "authors";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly posts: {
					readonly kind: "many";
					readonly collection: "posts";
					readonly optional: false;
				};
			};
			readonly media: readonly ["avatar"];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly posts: {
			readonly path: "posts";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly authorId: {
					readonly kind: "one";
					readonly collection: "authors";
					readonly optional: true;
				};
				readonly events: {
					readonly kind: "many";
					readonly collection: "events";
					readonly optional: false;
				};
				readonly fieldStaff: {
					readonly kind: "many";
					readonly collection: "fieldStaff";
					readonly optional: false;
				};
				readonly signups: {
					readonly kind: "many";
					readonly collection: "signups";
					readonly optional: false;
				};
				readonly comments: {
					readonly kind: "many";
					readonly collection: "comments";
					readonly optional: false;
				};
			};
			readonly media: readonly ["cover"];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly fieldStaff: {
			readonly path: "field_staff";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly postId: {
					readonly kind: "one";
					readonly collection: "posts";
					readonly optional: true;
				};
				readonly teamId: {
					readonly kind: "one";
					readonly collection: "fieldTeams";
					readonly optional: true;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
			readonly showIf: {
				readonly plan: {
					readonly when: {
						readonly kind: "pro";
					};
				};
				readonly discount: {
					readonly when: {
						readonly OR: readonly [{
							readonly kind: {
								readonly in: readonly ["basic", "pro"];
							};
						}, {
							readonly active: true;
						}];
					};
				};
				readonly headline: {
					readonly when: {
						readonly status: "published";
						readonly kind: "pro";
					};
				};
				readonly postNote: {
					readonly when: {
						readonly postId: {
							readonly ne: 1;
						};
					};
				};
				readonly always: {
					readonly when: {
						readonly OR: readonly [{}, {
							readonly kind: "pro";
						}];
					};
				};
				readonly notes: {
					readonly fields: {
						readonly private: {
							readonly when: {
								readonly public: {
									readonly isNotNull: true;
								};
							};
						};
					};
				};
			};
		};
		readonly tours: {
			readonly path: "tours";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: true;
			readonly relations: {
				readonly legs: {
					readonly kind: "many";
					readonly collection: "legs";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly talks: {
			readonly path: "talks";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly ["image"];
			readonly mediaList: readonly [];
			readonly files: readonly ["deck"];
		};
		readonly vault: {
			readonly path: "vault";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly ledger: {
			readonly path: "ledger";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly payroll: {
					readonly kind: "many";
					readonly collection: "payroll";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly payroll: {
			readonly path: "payroll";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly managerId: {
					readonly kind: "one";
					readonly collection: "ledger";
					readonly optional: true;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly dossier: {
			readonly path: "dossier";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly claims: {
			readonly path: "claims";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly gated: {
			readonly path: "gated";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly jottings: {
			readonly path: "jottings";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly notices: {
			readonly path: "notices";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly fuses: {
			readonly path: "fuses";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly oracleRows: {
			readonly path: "oracle_rows";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly oracleRefs: {
					readonly kind: "many";
					readonly collection: "oracleRefs";
					readonly optional: false;
				};
				readonly oracleSync: {
					readonly kind: "many";
					readonly collection: "oracleSync";
					readonly optional: false;
				};
				readonly refDefaults: {
					readonly kind: "many";
					readonly collection: "refDefaults";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly oracleRefs: {
			readonly path: "oracle_refs";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly rowId: {
					readonly kind: "one";
					readonly collection: "oracleRows";
					readonly optional: true;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly oracleSync: {
			readonly path: "oracle_sync";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly rowId: {
					readonly kind: "one";
					readonly collection: "oracleRows";
					readonly optional: true;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly oraclePeers: {
			readonly path: "oracle_peers";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: true;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly oracleParents: {
			readonly path: "oracle_parents";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly oracleKids: {
					readonly kind: "many";
					readonly collection: "oracleKids";
					readonly optional: false;
				};
				readonly mentees: {
					readonly kind: "many";
					readonly collection: "oracleKids";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly oracleKids: {
			readonly path: "oracle_kids";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly parentId: {
					readonly kind: "one";
					readonly collection: "oracleParents";
					readonly optional: true;
				};
				readonly mentors: {
					readonly kind: "many";
					readonly collection: "oracleParents";
					readonly optional: false;
				};
				readonly oracleTopics: {
					readonly kind: "many";
					readonly collection: "oracleTopics";
					readonly optional: false;
				};
				readonly oracleGrand: {
					readonly kind: "many";
					readonly collection: "oracleGrand";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly oracleGrand: {
			readonly path: "oracle_grand";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly childId: {
					readonly kind: "one";
					readonly collection: "oracleKids";
					readonly optional: true;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly oracleDefault: {
			readonly path: "oracle_default";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly nullParents: {
			readonly path: "null_parents";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly nullChildren: {
					readonly kind: "many";
					readonly collection: "nullChildren";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly nullChildren: {
			readonly path: "null_children";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly parentId: {
					readonly kind: "one";
					readonly collection: "nullParents";
					readonly optional: true;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly hookParents: {
			readonly path: "hook_parents";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly hookChildren: {
					readonly kind: "many";
					readonly collection: "hookChildren";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly hookChildren: {
			readonly path: "hook_children";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly parentId: {
					readonly kind: "one";
					readonly collection: "hookParents";
					readonly optional: true;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly secretParents: {
			readonly path: "secret_parents";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly secretLinks: {
			readonly path: "secret_links";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly refDefaults: {
			readonly path: "ref_defaults";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly targetId: {
					readonly kind: "one";
					readonly collection: "oracleRows";
					readonly optional: true;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly defaultOnly: {
			readonly path: "default_only";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly derivedRefs: {
			readonly path: "derived_refs";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly deepRoots: {
			readonly path: "deep_roots";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly deepNodes: {
					readonly kind: "many";
					readonly collection: "deepNodes";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly deepNodes: {
			readonly path: "deep_nodes";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly rootId: {
					readonly kind: "one";
					readonly collection: "deepRoots";
					readonly optional: true;
				};
				readonly parentId: {
					readonly kind: "one";
					readonly collection: "deepNodes";
					readonly optional: true;
				};
				readonly deepNodes: {
					readonly kind: "many";
					readonly collection: "deepNodes";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly roundTrips: {
			readonly path: "round_trips";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly legs: {
			readonly path: "legs";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: true;
			readonly relations: {
				readonly tourId: {
					readonly kind: "one";
					readonly collection: "tours";
					readonly optional: true;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly bulletins: {
			readonly path: "bulletins";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly fixedNotes: {
			readonly path: "fixed_notes";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly writers: {
			readonly path: "writers";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly guides: {
					readonly kind: "many";
					readonly collection: "guides";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly guides: {
			readonly path: "guides";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {
				readonly writerId: {
					readonly kind: "one";
					readonly collection: "writers";
					readonly optional: true;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly briefs: {
			readonly path: "briefs";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly memos: {
			readonly path: "memos";
			readonly primaryKey: "id";
			readonly drafts: true;
			readonly revisions: true;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly signups: {
			readonly path: "signups";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {
				readonly postId: {
					readonly kind: "one";
					readonly collection: "posts";
					readonly optional: true;
				};
				readonly teamId: {
					readonly kind: "one";
					readonly collection: "fieldTeams";
					readonly optional: true;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly comments: {
			readonly path: "comments";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {
				readonly postId: {
					readonly kind: "one";
					readonly collection: "posts";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly guestbook: {
			readonly path: "guestbook";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {
				readonly memberId: {
					readonly kind: "one";
					readonly collection: "members";
					readonly optional: true;
				};
				readonly members: {
					readonly kind: "many";
					readonly collection: "members";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly reviews: {
			readonly path: "reviews";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly memberUpdates: {
			readonly path: "member_updates";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly fieldTeams: {
			readonly path: "field_teams";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {
				readonly fieldStaff: {
					readonly kind: "many";
					readonly collection: "fieldStaff";
					readonly optional: false;
				};
				readonly signups: {
					readonly kind: "many";
					readonly collection: "signups";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly jobNotes: {
			readonly path: "job_notes";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly hookNotes: {
			readonly path: "hook_notes";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly tourLog: {
			readonly path: "tour_log";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly phrases: {
			readonly path: "phrases";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: true;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly uploadRecords: {
			readonly path: "upload_records";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly ["image"];
			readonly mediaList: readonly [];
			readonly files: readonly ["deck"];
		};
		readonly fuseLog: {
			readonly path: "fuse_log";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly guestCarts: {
			readonly path: "guest_carts";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {
				readonly memberId: {
					readonly kind: "one";
					readonly collection: "members";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly guestNotes: {
			readonly path: "guest_notes";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {
				readonly memberId: {
					readonly kind: "one";
					readonly collection: "members";
					readonly optional: true;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly bigCounts: {
			readonly path: "big_counts";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly bulletinLog: {
			readonly path: "bulletin_log";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {};
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
			readonly relations: {
				readonly sponsorId: {
					readonly kind: "one";
					readonly collection: "guestbook";
					readonly optional: true;
				};
				readonly guestbook: {
					readonly kind: "many";
					readonly collection: "guestbook";
					readonly optional: false;
				};
				readonly guestCarts: {
					readonly kind: "many";
					readonly collection: "guestCarts";
					readonly optional: false;
				};
				readonly guestNotes: {
					readonly kind: "many";
					readonly collection: "guestNotes";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
			readonly showIf: {
				readonly perk: {
					readonly when: {
						readonly plan: "pro";
					};
				};
				readonly badge: {
					readonly when: {
						readonly name: "Cy Edited";
					};
				};
				readonly sponsored: {
					readonly when: {
						readonly sponsorId: {
							readonly isNotNull: true;
						};
					};
				};
				readonly address: {
					readonly fields: {
						readonly district: {
							readonly when: {
								readonly city: "Oslo";
							};
						};
					};
				};
				readonly links: {
					readonly fields: {
						readonly detail: {
							readonly when: {
								readonly label: "visible";
							};
						};
					};
				};
				readonly sections: {
					readonly when: {
						readonly plan: "pro";
					};
					readonly layouts: {
						readonly quote: {
							readonly cite: {
								readonly when: {
									readonly text: "visible";
								};
							};
						};
					};
				};
			};
		};
		readonly oracleTopics: {
			readonly path: "oracle_topics";
			readonly primaryKey: "id";
			readonly drafts: false;
			readonly revisions: false;
			readonly localized: false;
			readonly relations: {
				readonly oracleKids: {
					readonly kind: "many";
					readonly collection: "oracleKids";
					readonly optional: false;
				};
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
	};
	readonly globals: readonly ["settings"];
	readonly actions: readonly ["bumpPostsPerPage", "approveComment", "publishedCount", "refsCount", "refsPurge", "refsRatio", "refsEmpty", "refsWire", "refsEcho", "agentNote", "refsEnqueue", "jobsOnce", "jobsTwice", "jobsInbound", "refsTranslations", "jotQuery", "jotWrite", "vaultPeek", "nativeHandler", "bigMath", "bulkTourPrice"];
	readonly buckets: readonly ["decks"];
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
	* (`First\Live\Module::evaluate`): its data is delivered at once and its token sent with the
	* first request. Returns a function that ends the subscription.
	*/
	subscribe(onData: (data: T) => void, onError?: (error: FirstError) => void, seed?: {
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
	/** `list(q).subscribe(onRows, onError)`. Returns a function that stops watching. */
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
	/** Base URL including the API prefix: "https://x.test/__first/api/v1". Default: `/__first/api/v1` on the page's origin. */
	url?: string;
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
* transport is live, or on its polling interval otherwise. For reads a `subscribe` can't express:
* an action's result, a global. Returns a function that stops watching.
*/
export declare function watch<T>(client: Client, collections: readonly CollectionKey[], read: () => Promise<T>, onResult: (value: T) => void, onError?: (error: FirstError) => void): () => void;
export {};
