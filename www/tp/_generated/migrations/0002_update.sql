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
	PRIMARY KEY (`id`),
	UNIQUE KEY `name_unique` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
