CREATE TABLE `{prefix}tp_stockItems` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`title` LONGTEXT NOT NULL,
	PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}tp_stockLinks` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`stockId` BIGINT UNSIGNED,
	PRIMARY KEY (`id`),
	CONSTRAINT `tp_stockLinks_stockId_fk` FOREIGN KEY (`stockId`) REFERENCES `{prefix}tp_stockItems` (`id`) ON DELETE SET NULL
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
