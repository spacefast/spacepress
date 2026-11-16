CREATE TABLE `{prefix}tp_loans` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`thingId` BIGINT UNSIGNED NOT NULL,
	`personId` BIGINT UNSIGNED NOT NULL,
	`lentOn` CHAR(10) NOT NULL,
	`dueOn` CHAR(10) NOT NULL,
	`returnedOn` CHAR(10),
	`overdueAt` CHAR(24),
	`ownerId` BIGINT NOT NULL,
	PRIMARY KEY (`id`),
	KEY `dueOn_queried` (`dueOn`),
	KEY `lentOn_queried` (`lentOn`),
	KEY `overdueAt_queried` (`overdueAt`),
	KEY `ownerId_queried` (`ownerId`),
	KEY `returnedOn_queried` (`returnedOn`)
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
