CREATE TABLE `{prefix}first_tasks` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`title` VARCHAR(120) NOT NULL,
	`done` TINYINT(1) DEFAULT 0 NOT NULL,
	`storyId` BIGINT UNSIGNED,
	`editorNote` LONGTEXT,
	PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}first_locations` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`name` VARCHAR(80) NOT NULL,
	`kind` VARCHAR(191) DEFAULT 'pantry' NOT NULL,
	PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}first_items` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`name` VARCHAR(120) NOT NULL,
	`brand` VARCHAR(80),
	`notes` LONGTEXT,
	`opened` TINYINT(1) DEFAULT 0 NOT NULL,
	`storyId` BIGINT UNSIGNED,
	`quantity` BIGINT DEFAULT 1 NOT NULL,
	`unit` VARCHAR(191) DEFAULT 'pcs' NOT NULL,
	`lowStockAt` BIGINT DEFAULT 1 NOT NULL,
	`expiresOn` CHAR(10),
	`locationId` BIGINT UNSIGNED,
	PRIMARY KEY (`id`),
	KEY `quantity_queried` (`quantity`),
	CONSTRAINT `first_items_locationId_fk` FOREIGN KEY (`locationId`) REFERENCES `{prefix}first_locations` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}first_shopping_list` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`itemId` BIGINT UNSIGNED NOT NULL,
	`name` VARCHAR(120) NOT NULL,
	`done` TINYINT(1) DEFAULT 0 NOT NULL,
	PRIMARY KEY (`id`),
	UNIQUE KEY `itemId_unique` (`itemId`),
	CONSTRAINT `first_shopping_list_itemId_fk` FOREIGN KEY (`itemId`) REFERENCES `{prefix}first_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}first__revisions` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`collection` VARCHAR(64) NOT NULL,
	`pk` VARCHAR(64) NOT NULL,
	`at` CHAR(24) NOT NULL,
	`userId` BIGINT,
	`row` LONGTEXT NOT NULL,
	PRIMARY KEY (`id`),
	KEY `row` (`collection`, `pk`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
