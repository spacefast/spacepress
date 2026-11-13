CREATE TABLE `{prefix}zero_things` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`n` BIGINT NOT NULL,
	`r` DOUBLE,
	`t` LONGTEXT,
	`day` CHAR(10),
	`at` CHAR(24),
	`plain` LONGTEXT,
	`mail` VARCHAR(191),
	`code` VARCHAR(40),
	`checked` LONGTEXT,
	`flag` TINYINT(1) DEFAULT 0 NOT NULL,
	`token` LONGTEXT NOT NULL,
	`m` BIGINT NOT NULL,
	`createdAt` CHAR(24) NOT NULL,
	`today` CHAR(10) NOT NULL,
	`updatedAt` CHAR(24) NOT NULL,
	`touched` BIGINT,
	PRIMARY KEY (`id`),
	UNIQUE KEY `mail_unique` (`mail`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}zero_codes` (
	`code` VARCHAR(40) NOT NULL,
	`label` LONGTEXT NOT NULL,
	PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}zero_post_log` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`postId` BIGINT UNSIGNED NOT NULL,
	`memberId` BIGINT UNSIGNED,
	`message` LONGTEXT NOT NULL,
	`status` VARCHAR(191) DEFAULT 'published' NOT NULL,
	`publishedAt` CHAR(24),
	PRIMARY KEY (`id`),
	KEY `status_publishedAt` (`status`, `publishedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
-- zero-adopt {"table":"wp_external_pinned","indexes":[{"name":"PRIMARY","unique":true,"columns":["id"]}],"foreignKeys":[],"integerColumns":[{"name":"id","unsigned":true}]}
SELECT `id`, `name` FROM `wp_external_pinned` LIMIT 0;
--> statement-breakpoint
CREATE TABLE `{prefix}zero__revisions` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`collection` VARCHAR(64) NOT NULL,
	`pk` VARCHAR(64) NOT NULL,
	`at` CHAR(24) NOT NULL,
	`userId` BIGINT,
	`row` LONGTEXT NOT NULL,
	PRIMARY KEY (`id`),
	KEY `row` (`collection`, `pk`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
