CREATE TABLE "authors" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"bio" text,
	"avatar" integer,
	"userId" integer,
	"status" text DEFAULT 'published' NOT NULL,
	"publishedAt" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "authors_email_unique" ON "authors" ("email");
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
	"gallery" text,
	"sections" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"publishedAt" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "posts_slug_unique" ON "posts" ("slug");
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
