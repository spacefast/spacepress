CREATE TABLE "authors" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"bio" text,
	"avatar" integer,
	"userId" integer,
	"status" text DEFAULT 'published' NOT NULL,
	"publishedAt" text,
	"uid" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "authors_email_unique" ON "authors" ("email");
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
	"excerpt" text,
	"cover" integer,
	"tags" text DEFAULT '[]' NOT NULL,
	"authorId" integer REFERENCES "authors"("id") ON DELETE set null,
	"seo" text,
	"deck" integer,
	"gallery" text,
	"sections" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"publishedAt" text,
	"uid" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"translationGroup" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "posts_slug_unique" ON "posts" ("slug");
--> statement-breakpoint
CREATE UNIQUE INDEX "posts_uid_unique" ON "posts" ("uid");
--> statement-breakpoint
CREATE INDEX "posts_status_publishedAt" ON "posts" ("status", "publishedAt");
--> statement-breakpoint
CREATE UNIQUE INDEX "posts_translationGroup_locale" ON "posts" ("translationGroup", "locale");
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"postId" integer NOT NULL REFERENCES "posts"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"approved" integer DEFAULT 0 NOT NULL,
	"notifiedAt" text,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"role" text DEFAULT 'subscriber' NOT NULL,
	"passwordHash" text,
	"suspendedAt" text,
	"guest" integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX "members_email_unique" ON "members" ("email");
