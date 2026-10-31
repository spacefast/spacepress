CREATE TABLE "locations" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'pantry' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"lowStockAt" integer DEFAULT 1 NOT NULL,
	"expiresOn" text,
	"opened" integer DEFAULT 0 NOT NULL,
	"locationId" integer REFERENCES "locations"("id") ON DELETE set null,
	"tags" text NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "items_slug_unique" ON "items" ("slug");
--> statement-breakpoint
CREATE TABLE "shopping_list" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"itemId" integer REFERENCES "items"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"notifiedAt" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_list_itemId_unique" ON "shopping_list" ("itemId");
