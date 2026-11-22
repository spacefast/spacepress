CREATE TABLE `{prefix}tp_shares` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`key` VARCHAR(12) NOT NULL,
	`example` VARCHAR(40) NOT NULL,
	`files` LONGTEXT NOT NULL,
	`author` BIGINT,
	`createdAt` CHAR(24) DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	`updatedAt` CHAR(24) DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	`deletedAt` CHAR(24),
	`deletedBy` BIGINT,
	`deletedGroup` VARCHAR(36),
	`_live` TINYINT(1) DEFAULT 1,
	PRIMARY KEY (`id`),
	UNIQUE KEY `key_unique` (`key`, `_live`),
	KEY `deletedAt_idx` (`deletedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}tp_examples` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`name` VARCHAR(60) NOT NULL,
	`title` VARCHAR(80) NOT NULL,
	`summary` LONGTEXT NOT NULL,
	`repo` VARCHAR(120) NOT NULL,
	`path` LONGTEXT DEFAULT ('') NOT NULL,
	`position` BIGINT DEFAULT 0 NOT NULL,
	`stars` BIGINT,
	`starsAt` CHAR(24),
	`author` BIGINT,
	`createdAt` CHAR(24) DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	`updatedAt` CHAR(24) DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	`deletedAt` CHAR(24),
	`deletedBy` BIGINT,
	`deletedGroup` VARCHAR(36),
	`_live` TINYINT(1) DEFAULT 1,
	PRIMARY KEY (`id`),
	UNIQUE KEY `name_unique` (`name`, `_live`),
	KEY `deletedAt_idx` (`deletedAt`),
	KEY `position_queried` (`position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}tp__revisions` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`collection` VARCHAR(64) NOT NULL,
	`pk` VARCHAR(191) NOT NULL,
	`version` BIGINT DEFAULT 1 NOT NULL,
	`op` VARCHAR(16) DEFAULT 'update' NOT NULL,
	`at` CHAR(24) NOT NULL,
	`userId` BIGINT,
	`schemaMigration` VARCHAR(191),
	`row` LONGTEXT NOT NULL,
	`changed` LONGTEXT,
	PRIMARY KEY (`id`),
	KEY `row` (`collection`, `pk`),
	UNIQUE KEY `row_version` (`collection`, `pk`, `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
