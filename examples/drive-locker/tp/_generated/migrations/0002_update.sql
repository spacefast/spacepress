ALTER TABLE `{prefix}tp_drives` ADD INDEX `label_queried` (`label`);
--> statement-breakpoint
ALTER TABLE `{prefix}tp_drives` ADD INDEX `ownerId_queried` (`ownerId`);
--> statement-breakpoint
ALTER TABLE `{prefix}tp_drives` ADD INDEX `replacementNeededAt_queried` (`replacementNeededAt`);
--> statement-breakpoint
ALTER TABLE `{prefix}tp_drives` ADD INDEX `status_queried` (`status`);
--> statement-breakpoint
ALTER TABLE `{prefix}tp_drives` ADD INDEX `warrantyUntil_queried` (`warrantyUntil`);
--> statement-breakpoint
ALTER TABLE `{prefix}tp_places` ADD INDEX `name_queried` (`name`);
--> statement-breakpoint
ALTER TABLE `{prefix}tp_places` ADD INDEX `ownerId_queried` (`ownerId`);
--> statement-breakpoint
ALTER TABLE `{prefix}tp_health_readings` ADD INDEX `ownerId_queried` (`ownerId`);
--> statement-breakpoint
ALTER TABLE `{prefix}tp_health_readings` ADD INDEX `readOn_queried` (`readOn`);
--> statement-breakpoint
ALTER TABLE `{prefix}tp_contents` ADD INDEX `ownerId_queried` (`ownerId`);
