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
ALTER TABLE "posts" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "translationGroup" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "posts_translationGroup_locale" ON "posts" ("translationGroup", "locale");
