CREATE TABLE `{prefix}tp_places` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`ownerId` BIGINT DEFAULT 0 NOT NULL,
	`name` VARCHAR(120) NOT NULL,
	`kind` VARCHAR(191) NOT NULL,
	PRIMARY KEY (`id`)
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
--> statement-breakpoint
CREATE TABLE `{prefix}tp_drives` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`ownerId` BIGINT DEFAULT 0 NOT NULL,
	`label` VARCHAR(120) NOT NULL,
	`model` VARCHAR(160) NOT NULL,
	`serial` VARCHAR(160) NOT NULL,
	`serialKey` VARCHAR(191) DEFAULT '' NOT NULL,
	`kind` VARCHAR(191) NOT NULL,
	`capacityGb` DOUBLE NOT NULL,
	`interface` VARCHAR(80) NOT NULL,
	`purchasedOn` CHAR(10),
	`warrantyUntil` CHAR(10),
	`placeId` BIGINT UNSIGNED,
	`status` VARCHAR(191) DEFAULT 'spare' NOT NULL,
	`notes` LONGTEXT,
	`tags` LONGTEXT NOT NULL,
	`replacementNeededAt` CHAR(24),
	PRIMARY KEY (`id`),
	UNIQUE KEY `serialKey_unique` (`serialKey`),
	CONSTRAINT `tp_drives_placeId_fk` FOREIGN KEY (`placeId`) REFERENCES `{prefix}tp_places` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}tp_health_readings` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`ownerId` BIGINT DEFAULT 0 NOT NULL,
	`driveId` BIGINT UNSIGNED NOT NULL,
	`readOn` CHAR(10) NOT NULL,
	`powerOnHours` BIGINT NOT NULL,
	`wearPercent` DOUBLE NOT NULL,
	`reallocatedSectors` BIGINT NOT NULL,
	`tempC` DOUBLE NOT NULL,
	PRIMARY KEY (`id`),
	CONSTRAINT `tp_health_readings_driveId_fk` FOREIGN KEY (`driveId`) REFERENCES `{prefix}tp_drives` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}tp_contents` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`ownerId` BIGINT DEFAULT 0 NOT NULL,
	`driveId` BIGINT UNSIGNED NOT NULL,
	`description` LONGTEXT NOT NULL,
	`usedGb` DOUBLE NOT NULL,
	`lastBackupOn` CHAR(10),
	PRIMARY KEY (`id`),
	CONSTRAINT `tp_contents_driveId_fk` FOREIGN KEY (`driveId`) REFERENCES `{prefix}tp_drives` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
