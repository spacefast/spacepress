CREATE TABLE `{prefix}tp_shares` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`key` VARCHAR(12) NOT NULL,
	`example` VARCHAR(40) NOT NULL,
	`files` LONGTEXT NOT NULL,
	PRIMARY KEY (`id`),
	UNIQUE KEY `key_unique` (`key`)
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
