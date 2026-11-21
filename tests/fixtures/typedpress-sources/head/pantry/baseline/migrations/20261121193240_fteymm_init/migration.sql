CREATE TABLE `{prefix}tp_locations` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`name` LONGTEXT NOT NULL,
	`kind` VARCHAR(191) DEFAULT 'pantry' NOT NULL,
	`author` BIGINT,
	`createdAt` CHAR(24) DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	`updatedAt` CHAR(24) DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	`deletedAt` CHAR(24),
	`deletedBy` BIGINT,
	`deletedGroup` VARCHAR(36),
	`_live` TINYINT(1) DEFAULT 1,
	PRIMARY KEY (`id`),
	KEY `deletedAt_idx` (`deletedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}tp_items` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`name` LONGTEXT NOT NULL,
	`slug` VARCHAR(191) NOT NULL,
	`quantity` BIGINT DEFAULT 1 NOT NULL,
	`unit` VARCHAR(191) DEFAULT 'pcs' NOT NULL,
	`lowStockAt` BIGINT DEFAULT 1 NOT NULL,
	`expiresOn` CHAR(10),
	`opened` TINYINT(1) DEFAULT 0 NOT NULL,
	`locationId` BIGINT UNSIGNED,
	`tags` LONGTEXT NOT NULL,
	`createdAt` CHAR(24) DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	`updatedAt` CHAR(24) DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	`author` BIGINT,
	`deletedAt` CHAR(24),
	`deletedBy` BIGINT,
	`deletedGroup` VARCHAR(36),
	`_live` TINYINT(1) DEFAULT 1,
	PRIMARY KEY (`id`),
	UNIQUE KEY `slug_unique` (`slug`, `_live`),
	KEY `deletedAt_idx` (`deletedAt`),
	KEY `expiresOn_queried` (`expiresOn`),
	KEY `quantity_queried` (`quantity`),
	CONSTRAINT `tp_items_locationId_fk` FOREIGN KEY (`locationId`) REFERENCES `{prefix}tp_locations` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}tp_shopping_list` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`itemId` BIGINT UNSIGNED,
	`name` LONGTEXT NOT NULL,
	`done` TINYINT(1) DEFAULT 0 NOT NULL,
	`notifiedAt` CHAR(24),
	`createdAt` CHAR(24) DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	`updatedAt` CHAR(24) DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	`author` BIGINT,
	`deletedAt` CHAR(24),
	`deletedBy` BIGINT,
	`deletedGroup` VARCHAR(36),
	`_live` TINYINT(1) DEFAULT 1,
	PRIMARY KEY (`id`),
	UNIQUE KEY `itemId_unique` (`itemId`, `_live`),
	KEY `deletedAt_idx` (`deletedAt`),
	KEY `done_queried` (`done`),
	CONSTRAINT `tp_shopping_list_itemId_fk` FOREIGN KEY (`itemId`) REFERENCES `{prefix}tp_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}tp__revisions` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`collection` VARCHAR(64) NOT NULL,
	`pk` VARCHAR(64) NOT NULL,
	`at` CHAR(24) NOT NULL,
	`userId` BIGINT,
	`row` LONGTEXT NOT NULL,
	PRIMARY KEY (`id`),
	KEY `row` (`collection`, `pk`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
