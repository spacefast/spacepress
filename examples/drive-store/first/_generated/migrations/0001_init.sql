CREATE TABLE `{prefix}first_orders` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`code` VARCHAR(16) NOT NULL,
	`drive` BIGINT UNSIGNED NOT NULL,
	`quantity` BIGINT DEFAULT 1 NOT NULL,
	`unitPrice` DOUBLE DEFAULT 0 NOT NULL,
	`total` DOUBLE DEFAULT 0 NOT NULL,
	`buyerName` VARCHAR(80) NOT NULL,
	`buyerEmail` VARCHAR(191) NOT NULL,
	`buyerId` BIGINT DEFAULT 0 NOT NULL,
	`status` VARCHAR(191) DEFAULT 'placed' NOT NULL,
	`placedAt` CHAR(24) NOT NULL,
	`shippedAt` CHAR(24),
	PRIMARY KEY (`id`),
	UNIQUE KEY `code_unique` (`code`),
	KEY `buyerId_queried` (`buyerId`),
	KEY `status_queried` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `{prefix}first_stock_movements` (
	`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	`drive` BIGINT UNSIGNED NOT NULL,
	`change` BIGINT NOT NULL,
	`reason` VARCHAR(191) NOT NULL,
	`order` BIGINT UNSIGNED,
	`note` LONGTEXT,
	`at` CHAR(24) NOT NULL,
	PRIMARY KEY (`id`),
	CONSTRAINT `first_stock_movements_order_fk` FOREIGN KEY (`order`) REFERENCES `{prefix}first_orders` (`id`) ON DELETE SET NULL
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
