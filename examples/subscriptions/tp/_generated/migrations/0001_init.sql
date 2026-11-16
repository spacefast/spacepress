CREATE TABLE `{prefix}tp_subscriptions` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`ownerId` BIGINT DEFAULT 0 NOT NULL,
	`name` VARCHAR(100) NOT NULL,
	`vendor` VARCHAR(100) DEFAULT '' NOT NULL,
	`amount` BIGINT NOT NULL,
	`currency` LONGTEXT DEFAULT ('USD') NOT NULL,
	`cycle` VARCHAR(191) DEFAULT 'monthly' NOT NULL,
	`nextRenewal` CHAR(10) NOT NULL,
	`category` VARCHAR(60) DEFAULT 'Other' NOT NULL,
	`paymentMethod` VARCHAR(100) DEFAULT '' NOT NULL,
	`cancelUrl` LONGTEXT DEFAULT ('') NOT NULL,
	`notes` LONGTEXT DEFAULT ('') NOT NULL,
	`status` VARCHAR(191) DEFAULT 'active' NOT NULL,
	`remindedAt` CHAR(24),
	PRIMARY KEY (`id`),
	KEY `nextRenewal_queried` (`nextRenewal`),
	KEY `ownerId_queried` (`ownerId`),
	KEY `status_queried` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}tp_charges` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`ownerId` BIGINT DEFAULT 0 NOT NULL,
	`subscriptionId` BIGINT UNSIGNED NOT NULL,
	`amount` BIGINT NOT NULL,
	`chargedOn` CHAR(10) NOT NULL,
	PRIMARY KEY (`id`),
	KEY `ownerId_queried` (`ownerId`),
	CONSTRAINT `tp_charges_subscriptionId_fk` FOREIGN KEY (`subscriptionId`) REFERENCES `{prefix}tp_subscriptions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}tp_categories` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`ownerId` BIGINT DEFAULT 0 NOT NULL,
	`name` VARCHAR(60) NOT NULL,
	PRIMARY KEY (`id`),
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
