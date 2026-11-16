CREATE TABLE `{prefix}tp_stock` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`ownerId` BIGINT NOT NULL,
	`foodId` BIGINT UNSIGNED NOT NULL,
	`gramsLeft` DOUBLE NOT NULL,
	`openedOn` CHAR(10),
	`expiresOn` CHAR(10),
	PRIMARY KEY (`id`),
	KEY `expiresOn_queried` (`expiresOn`),
	KEY `gramsLeft_queried` (`gramsLeft`),
	KEY `ownerId_queried` (`ownerId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}tp_feedings` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`ownerId` BIGINT NOT NULL,
	`petId` BIGINT UNSIGNED NOT NULL,
	`foodId` BIGINT UNSIGNED NOT NULL,
	`grams` DOUBLE NOT NULL,
	`fedAt` CHAR(24) NOT NULL,
	`costCents` DOUBLE NOT NULL,
	PRIMARY KEY (`id`),
	KEY `fedAt_queried` (`fedAt`),
	KEY `ownerId_queried` (`ownerId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}tp_shopping_list` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`ownerId` BIGINT NOT NULL,
	`foodId` BIGINT UNSIGNED NOT NULL,
	`needed` TINYINT(1) DEFAULT 0 NOT NULL,
	`checkedAt` CHAR(24),
	PRIMARY KEY (`id`),
	UNIQUE KEY `foodId_unique` (`foodId`),
	KEY `ownerId_queried` (`ownerId`)
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
