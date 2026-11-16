ALTER TABLE `{prefix}tp_drives` DROP INDEX `serialKey_unique`;
--> statement-breakpoint
ALTER TABLE `{prefix}tp_drives` DROP INDEX `ownerId_queried`;
--> statement-breakpoint
-- typedpress-check {"check":"drop","name":"drives.serialKey","table":"{prefix}tp_drives","column":"serialKey","adopted":false}
ALTER TABLE `{prefix}tp_drives` DROP COLUMN `serialKey`;
--> statement-breakpoint
ALTER TABLE `{prefix}tp_drives` ADD UNIQUE KEY `idx_ownerId_serial` (`ownerId`, `serial`);
