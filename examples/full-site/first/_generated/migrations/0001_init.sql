CREATE TABLE `{prefix}first_cheers` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`noteId` BIGINT UNSIGNED NOT NULL,
	`count` BIGINT DEFAULT 0 NOT NULL,
	PRIMARY KEY (`id`),
	UNIQUE KEY `noteId_unique` (`noteId`)
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
