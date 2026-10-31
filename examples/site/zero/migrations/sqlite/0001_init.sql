CREATE TABLE "authors" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"name" text NOT NULL,
	"bio" text,
	"avatar" integer,
	"userId" integer,
	"status" text DEFAULT 'published' NOT NULL,
	"publishedAt" text,
	"uid" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "authors_uid_unique" ON "authors" ("uid");
--> statement-breakpoint
CREATE INDEX "authors_status_publishedAt" ON "authors" ("status", "publishedAt");
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"title" text NOT NULL,
	"slug" text,
	"body" text,
	"dek" text,
	"cover" integer,
	"manuscript" integer,
	"topics" text DEFAULT '[]' NOT NULL,
	"featured" integer DEFAULT 0 NOT NULL,
	"deskNotes" text,
	"authorId" integer REFERENCES "authors"("id") ON DELETE set null,
	"seo" text,
	"related" text,
	"sections" text,
	"updatedAt" text NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"publishedAt" text,
	"uid" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "posts_slug_unique" ON "posts" ("slug");
--> statement-breakpoint
CREATE UNIQUE INDEX "posts_uid_unique" ON "posts" ("uid");
--> statement-breakpoint
CREATE INDEX "posts_status_publishedAt" ON "posts" ("status", "publishedAt");
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"postId" integer NOT NULL REFERENCES "posts"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"approved" integer DEFAULT 0 NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"email" text NOT NULL,
	"postId" integer REFERENCES "posts"("id") ON DELETE set null,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "subscribers_email_unique" ON "subscribers" ("email");
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"postId" integer NOT NULL REFERENCES "posts"("id") ON DELETE cascade,
	"recipients" integer NOT NULL,
	"attempt" integer NOT NULL
);
