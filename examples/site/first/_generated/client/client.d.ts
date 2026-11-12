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
export type Locale = "en" | "de";
export interface Author {
	id: number;
	name: string;
	bio: string | null;
	avatar: number | null;
	userId: number | null;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
	uid: string | null;
}
export interface AuthorInsert {
	name: string;
	bio?: string | null;
	avatar?: number | null;
	userId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface AuthorPatch {
	name?: string;
	bio?: string | null;
	avatar?: number | null;
	userId?: number | null;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
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
	posts?: true | PostFilter;
	AND?: AuthorFilter[];
	OR?: AuthorFilter[];
	NOT?: AuthorFilter;
}
export type AuthorOrder = Partial<Record<"id" | "name" | "bio" | "avatar" | "userId" | "status" | "publishedAt" | "uid", "asc" | "desc">> | string;
export interface Post {
	id: number;
	title: string;
	slug: string | null;
	body: string | null;
	dek: string | null;
	cover: number | null;
	manuscript: number | null;
	topics: ("culture" | "science" | "tech")[];
	featured: boolean;
	deskNotes?: string | null;
	authorId: number | null;
	seo: {
		noindex: boolean;
		metaTitle: string | null;
	} | null;
	related: {
		label: string;
		href: string;
	}[] | null;
	sections: ({
		layout: "pullQuote";
		text: string;
		cite: string | null;
	} | {
		layout: "figure";
		image: number;
		caption: string | null;
	})[] | null;
	updatedAt: string;
	status: "draft" | "published" | "scheduled";
	publishedAt: string | null;
	uid: string | null;
	locale: "en" | "de";
	translations: Partial<Record<"en" | "de", number>>;
}
export interface PostFields {
	title: string;
	slug?: string | null;
	body?: string | null;
	dek?: string | null;
	cover?: number | null;
	manuscript?: number | null;
	topics?: ("culture" | "science" | "tech")[];
	featured?: boolean;
	deskNotes?: string | null;
	authorId?: number | null;
	seo?: {
		noindex?: boolean;
		metaTitle?: string | null;
	} | null;
	related?: {
		label: string;
		href: string;
	}[] | null;
	sections?: ({
		layout: "pullQuote";
		text: string;
		cite?: string | null;
	} | {
		layout: "figure";
		image: number;
		caption?: string | null;
	})[] | null;
	updatedAt?: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
	locale?: "en" | "de";
	translationOf?: undefined;
}
export type PostInsert = PostFields | (Omit<PostFields, "cover" | "manuscript" | "topics" | "featured" | "deskNotes" | "authorId" | "seo" | "related" | "sections" | "updatedAt" | "translationOf"> & Partial<Pick<PostFields, "cover" | "manuscript" | "topics" | "featured" | "deskNotes" | "authorId" | "seo" | "related" | "sections" | "updatedAt">> & {
	translationOf: number;
});
export interface PostPatch {
	title?: string;
	slug?: string | null;
	body?: string | null;
	dek?: string | null;
	cover?: number | null;
	manuscript?: number | null;
	topics?: ("culture" | "science" | "tech")[];
	featured?: boolean;
	deskNotes?: string | null;
	authorId?: number | null;
	seo?: {
		noindex?: boolean;
		metaTitle?: string | null;
	} | null;
	related?: {
		label: string;
		href: string;
	}[] | null;
	sections?: ({
		layout: "pullQuote";
		text: string;
		cite?: string | null;
	} | {
		layout: "figure";
		image: number;
		caption?: string | null;
	})[] | null;
	updatedAt?: string;
	status?: "draft" | "published" | "scheduled";
	publishedAt?: string | null;
	uid?: string | null;
}
export interface PostWith {
	authorId?: true | {
		where?: AuthorFilter;
		orderBy?: AuthorOrder;
		limit?: number;
		offset?: number;
		with?: AuthorWith;
	};
	comments?: true | {
		where?: CommentFilter;
		orderBy?: CommentOrder;
		limit?: number;
		offset?: number;
		with?: CommentWith;
	};
	subscribers?: true | {
		where?: SubscriberFilter;
		orderBy?: SubscriberOrder;
		limit?: number;
		offset?: number;
		with?: SubscriberWith;
	};
	announcements?: true | {
		where?: AnnouncementFilter;
		orderBy?: AnnouncementOrder;
		limit?: number;
		offset?: number;
		with?: AnnouncementWith;
	};
	cover?: true;
	manuscript?: true;
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
	dek?: string | null | {
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
	manuscript?: number | null | {
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
	topics?: [] | null | {
		has?: "culture" | "science" | "tech";
		eq?: [];
		isNull?: true;
		isNotNull?: true;
	};
	featured?: boolean | null | {
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
	deskNotes?: string | null | {
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
		noindex: boolean;
		metaTitle: string | null;
	} | null | {
		eq?: {
			noindex: boolean;
			metaTitle: string | null;
		} | null;
		ne?: {
			noindex: boolean;
			metaTitle: string | null;
		} | null;
		isNull?: true;
		isNotNull?: true;
	};
	related?: {
		label: string;
		href: string;
	}[] | null | {
		eq?: {
			label: string;
			href: string;
		}[] | null;
		ne?: {
			label: string;
			href: string;
		}[] | null;
		isNull?: true;
		isNotNull?: true;
	};
	sections?: ({
		layout: "pullQuote";
		text: string;
		cite: string | null;
	} | {
		layout: "figure";
		image: number;
		caption: string | null;
	})[] | null | {
		eq?: ({
			layout: "pullQuote";
			text: string;
			cite: string | null;
		} | {
			layout: "figure";
			image: number;
			caption: string | null;
		})[] | null;
		ne?: ({
			layout: "pullQuote";
			text: string;
			cite: string | null;
		} | {
			layout: "figure";
			image: number;
			caption: string | null;
		})[] | null;
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
	locale?: "en" | "de" | null | {
		eq?: "en" | "de" | null;
		ne?: "en" | "de" | null;
		gt?: "en" | "de";
		gte?: "en" | "de";
		lt?: "en" | "de";
		lte?: "en" | "de";
		in?: ("en" | "de")[];
		notIn?: ("en" | "de")[];
		like?: string;
		ilike?: string;
		notLike?: string;
		notIlike?: string;
		isNull?: true;
		isNotNull?: true;
	};
	comments?: true | CommentFilter;
	subscribers?: true | SubscriberFilter;
	announcements?: true | AnnouncementFilter;
	AND?: PostFilter[];
	OR?: PostFilter[];
	NOT?: PostFilter;
}
export type PostOrder = Partial<Record<"id" | "title" | "slug" | "body" | "dek" | "cover" | "manuscript" | "featured" | "deskNotes" | "authorId" | "updatedAt" | "status" | "publishedAt" | "uid" | "locale", "asc" | "desc">> | string;
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
export interface Subscriber {
	id: number;
	email: string;
	postId: number | null;
	createdAt: string;
}
export interface SubscriberInsert {
	email: string;
	postId?: number | null;
	createdAt?: string;
}
export interface SubscriberPatch {
	email?: string;
	postId?: number | null;
	createdAt?: string;
}
export interface SubscriberWith {
	postId?: true | {
		where?: PostFilter;
		orderBy?: PostOrder;
		limit?: number;
		offset?: number;
		with?: PostWith;
	};
}
export interface SubscriberFilter {
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
	AND?: SubscriberFilter[];
	OR?: SubscriberFilter[];
	NOT?: SubscriberFilter;
}
export type SubscriberOrder = Partial<Record<"id" | "email" | "postId" | "createdAt", "asc" | "desc">> | string;
export interface Announcement {
	id: number;
	postId: number;
	recipients?: number;
	attempt: number;
}
export interface AnnouncementInsert {
	postId: number;
	recipients: number;
	attempt: number;
}
export interface AnnouncementPatch {
	postId?: number;
	recipients?: number;
	attempt?: number;
}
export interface AnnouncementWith {
	postId?: true | {
		where?: PostFilter;
		orderBy?: PostOrder;
		limit?: number;
		offset?: number;
		with?: PostWith;
	};
}
export interface AnnouncementFilter {
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
	recipients?: number | null | {
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
	attempt?: number | null | {
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
	AND?: AnnouncementFilter[];
	OR?: AnnouncementFilter[];
	NOT?: AnnouncementFilter;
}
export type AnnouncementOrder = Partial<Record<"id" | "postId" | "recipients" | "attempt", "asc" | "desc">> | string;
export interface Member {
	id: number;
	email: string;
	name: string;
	plan: "free" | "supporter";
	role: "guest" | "subscriber" | "author" | "editor" | "admin";
}
export interface MemberInsert {
	email: string;
	name: string;
	plan?: "free" | "supporter";
	role?: "guest" | "subscriber" | "author" | "editor" | "admin";
	password?: string;
}
export interface MemberPatch {
	email?: string;
	name?: string;
	plan?: "free" | "supporter";
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
	plan?: "free" | "supporter" | null | {
		eq?: "free" | "supporter" | null;
		ne?: "free" | "supporter" | null;
		gt?: "free" | "supporter";
		gte?: "free" | "supporter";
		lt?: "free" | "supporter";
		lte?: "free" | "supporter";
		in?: ("free" | "supporter")[];
		notIn?: ("free" | "supporter")[];
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
export type MemberOrder = Partial<Record<"id" | "email" | "name" | "plan" | "role", "asc" | "desc">> | string;
export interface Settings {
	siteTitle: string;
	tagline: string | null;
	commentsOpen: boolean;
	social: {
		label: string;
		href: string;
	}[] | null;
}
export interface SettingsPatch {
	siteTitle?: string;
	tagline?: string | null;
	commentsOpen?: boolean;
	social?: {
		label: string;
		href: string;
	}[] | null;
}
export interface SubscribeNewsletterInput {
	email: string;
	postId?: number | null;
}
export type SubscribeNewsletterOutput = {
	accepted: boolean;
};
export interface RemovePostInput {
	id: number;
}
export type RemovePostOutput = {
	id: number;
};
export interface ModerateCommentInput {
	id: number;
	decision: "approve" | "reject";
}
export type ModerateCommentOutput = {
	id: number;
	approved: boolean;
	removed: boolean;
} | {
	id: number;
	approved: boolean;
	removed: boolean;
};
export type FrontPageInput = Record<string, never>;
export type FrontPageOutput = {
	featured: number[];
};
export interface Collections {
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
	comments: {
		row: Comment;
		insert: CommentInsert;
		patch: CommentPatch;
		with: CommentWith;
		filter: CommentFilter;
		order: CommentOrder;
	};
	subscribers: {
		row: Subscriber;
		insert: SubscriberInsert;
		patch: SubscriberPatch;
		with: SubscriberWith;
		filter: SubscriberFilter;
		order: SubscriberOrder;
	};
	announcements: {
		row: Announcement;
		insert: AnnouncementInsert;
		patch: AnnouncementPatch;
		with: AnnouncementWith;
		filter: AnnouncementFilter;
		order: AnnouncementOrder;
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
export interface Globals {
	settings: {
		row: Settings;
		patch: SettingsPatch;
	};
}
export interface Actions {
	subscribeNewsletter: {
		input: SubscribeNewsletterInput;
		output: SubscribeNewsletterOutput;
	};
	removePost: {
		input: RemovePostInput;
		output: RemovePostOutput;
	};
	moderateComment: {
		input: ModerateCommentInput;
		output: ModerateCommentOutput;
	};
	frontPage: {
		input: FrontPageInput;
		output: FrontPageOutput;
	};
}
export declare const SCHEMA: {
	readonly name: "site";
	readonly collections: {
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
			readonly localized: true;
			readonly relations: {
				readonly authorId: {
					readonly kind: "one";
					readonly collection: "authors";
					readonly optional: true;
				};
				readonly comments: {
					readonly kind: "many";
					readonly collection: "comments";
					readonly optional: false;
				};
				readonly subscribers: {
					readonly kind: "many";
					readonly collection: "subscribers";
					readonly optional: false;
				};
				readonly announcements: {
					readonly kind: "many";
					readonly collection: "announcements";
					readonly optional: false;
				};
			};
			readonly media: readonly ["cover"];
			readonly mediaList: readonly [];
			readonly files: readonly ["manuscript"];
			readonly showIf: {
				readonly seo: {
					readonly fields: {
						readonly metaTitle: {
							readonly when: {
								readonly noindex: false;
							};
						};
					};
				};
			};
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
		readonly subscribers: {
			readonly path: "subscribers";
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
			};
			readonly media: readonly [];
			readonly mediaList: readonly [];
			readonly files: readonly [];
		};
		readonly announcements: {
			readonly path: "announcements";
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
	readonly globals: readonly ["settings"];
	readonly actions: readonly ["subscribeNewsletter", "removePost", "moderateComment", "frontPage"];
	readonly buckets: readonly ["manuscripts"];
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
	/** `GET /_schema`: the app's public schema description. */
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
	/** Base URL including the REST prefix: "https://x.test/wp-json/first/v1". Default: `/wp-json/first/v1` on the page's origin. */
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
