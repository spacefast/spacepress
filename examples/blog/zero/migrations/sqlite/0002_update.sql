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
--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "uid" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "authors_uid_unique" ON "authors" ("uid");
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "deck" integer;
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "uid" text;
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "translationGroup" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "posts_uid_unique" ON "posts" ("uid");
--> statement-breakpoint
CREATE UNIQUE INDEX "posts_translationGroup_locale" ON "posts" ("translationGroup", "locale");
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "notifiedAt" text;
