CREATE TABLE "locations" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'pantry'
);
--> statement-breakpoint
CREATE TABLE "items" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unit" TEXT NOT NULL DEFAULT 'pcs',
  "lowStockAt" INTEGER NOT NULL DEFAULT 1,
  "expiresOn" TEXT,
  "opened" INTEGER NOT NULL DEFAULT 0,
  "locationId" INTEGER REFERENCES "locations"("id") ON DELETE SET NULL,
  "tags" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_list" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "itemId" INTEGER UNIQUE REFERENCES "items"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "done" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
