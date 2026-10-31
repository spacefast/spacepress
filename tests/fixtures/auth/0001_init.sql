CREATE TABLE "members" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"billing" text,
	"profile" text,
	"role" text DEFAULT 'subscriber' NOT NULL,
	"passwordHash" text,
	"suspendedAt" text,
	"guest" integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX "members_email_unique" ON "members" ("email");
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"body" text NOT NULL,
	"memberId" integer REFERENCES "members"("id")
);
