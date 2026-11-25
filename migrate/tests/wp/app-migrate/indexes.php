<?php
declare(strict_types=1);

$plugin = \SpacePress\Wp\Runtime::plugin();
$wpdb = clone $plugin->connection()->wpdb();
$wpdb->set_prefix('adopt_');
$db = new \SpacePress\Wp\Connection($wpdb);
$schema = \SpacePress\Schema::load('/tmp/spacepress-app-migrate-indexes/sp/app/schema.php');
$dir = '/tmp/spacepress-app-migrate-indexes/sp/app/migrations';
$migrator = new \SpacePress\Wp\Migrator($db, $dir, $schema);
$ledger = $db->prefix() . 'sp__migrations';
$table = 'adopt_legacy_contacts';
$bookmarks = $db->prefix() . 'sp_bookmarks';
$revisions = $db->prefix() . 'sp__revisions';
$otherDatabase = 'sp_adopt_other';
$check = static function (bool $ok, string $message): void {
    if (!$ok) { throw new \RuntimeException($message); }
};
try {
    $db->run("CREATE TABLE `$table` (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `email` VARCHAR(191), `active` TINYINT(1) DEFAULT 0, `parentId` BIGINT UNSIGNED NULL, PRIMARY KEY (`id`), UNIQUE KEY `old_email_key` (`email`)) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4");
    $db->run("INSERT INTO `$table` (`id`, `email`) VALUES (9007199254740991, 'retained@example.test')");
    $rows = $db->run("SELECT * FROM `$table`");
    $ddl = $db->run("SHOW CREATE TABLE `$table`");
    try {
        $migrator->migrate();
        throw new \LogicException('adoption accepted a nontransactional table');
    } catch (\RuntimeException $e) {
        $check(str_contains($e->getMessage(), "InnoDB tables with utf8mb4; these are incompatible: $table"), $e->getMessage());
    }
    $check($db->run("SHOW CREATE TABLE `$table`") === $ddl, 'refused storage engine changed the table');
    $check(!$migrator->hasLedger(), 'refused storage engine created a migration ledger');
    $check($db->run("SHOW TABLES LIKE '$bookmarks'") === [], 'refused storage engine ran earlier migration DDL');
    $db->run("ALTER TABLE `$table` ENGINE=InnoDB");
    $db->run("ALTER TABLE `$table` ADD CONSTRAINT `old_parent_fk` FOREIGN KEY (`parentId`) REFERENCES `$table` (`id`) ON DELETE SET NULL");
    $ddl = $db->run("SHOW CREATE TABLE `$table`");
    $check(!$migrator->hasLedger(), 'fixture already has a migration ledger');
    try {
        $migrator->migrate();
        throw new \LogicException('adoption accepted an index name absent from its snapshot');
    } catch (\RuntimeException $e) {
        $check(str_contains($e->getMessage(), 'Cannot adopt adopt_legacy_contacts: index email_unique'), $e->getMessage());
    }
    $check($db->run("SHOW CREATE TABLE `$table`") === $ddl, 'refused adoption changed the table');
    $check(!$migrator->hasLedger(), 'refused adoption created a migration ledger');
    $check($db->run("SHOW TABLES LIKE '$bookmarks'") === [], 'refused adoption ran earlier migration DDL');
    $db->run("ALTER TABLE `$table` RENAME INDEX `old_email_key` TO `email_unique`");
    $ddl = $db->run("SHOW CREATE TABLE `$table`");
    try {
        $migrator->migrate();
        throw new \LogicException('adoption accepted a foreign key name absent from its snapshot');
    } catch (\RuntimeException $e) {
        $check(str_contains($e->getMessage(), 'foreign key sp_contacts_parentId_fk'), $e->getMessage());
    }
    $check($db->run("SHOW CREATE TABLE `$table`") === $ddl, 'refused foreign key adoption changed the table');
    $check(!$migrator->hasLedger(), 'refused foreign key adoption created a migration ledger');
    $db->run("CREATE TABLE `$otherDatabase`.`$table` (`id` BIGINT UNSIGNED NOT NULL PRIMARY KEY) ENGINE=InnoDB");
    $db->run("ALTER TABLE `$table` DROP FOREIGN KEY `old_parent_fk`, ADD CONSTRAINT `sp_contacts_parentId_fk` FOREIGN KEY (`parentId`) REFERENCES `$otherDatabase`.`$table` (`id`) ON DELETE SET NULL");
    $ddl = $db->run("SHOW CREATE TABLE `$table`");
    try {
        $migrator->migrate();
        throw new \LogicException('adoption accepted a foreign key targeting another database');
    } catch (\RuntimeException $e) {
        $check(str_contains($e->getMessage(), 'foreign key sp_contacts_parentId_fk'), $e->getMessage());
    }
    $check($db->run("SHOW CREATE TABLE `$table`") === $ddl, 'cross-database adoption changed the table');
    $check(!$migrator->hasLedger(), 'cross-database adoption created a migration ledger');
    $check($db->run("SHOW TABLES LIKE '$bookmarks'") === [], 'cross-database adoption ran earlier migration DDL');
    $db->run("ALTER TABLE `$table` DROP FOREIGN KEY `sp_contacts_parentId_fk`");
    $db->run("ALTER TABLE `$table` MODIFY `id` BIGINT NOT NULL AUTO_INCREMENT, MODIFY `parentId` BIGINT NULL");
    $db->run("ALTER TABLE `$table` ADD CONSTRAINT `sp_contacts_parentId_fk` FOREIGN KEY (`parentId`) REFERENCES `$table` (`id`) ON DELETE SET NULL");
    $ddl = $db->run("SHOW CREATE TABLE `$table`");
    try {
        $migrator->migrate();
        throw new \LogicException('adoption accepted signed keys for an unsigned foreign key');
    } catch (\RuntimeException $e) {
        $check(str_contains($e->getMessage(), 'column id must use BIGINT UNSIGNED'), $e->getMessage());
    }
    $check($db->run("SHOW CREATE TABLE `$table`") === $ddl, 'signed key refusal changed the table');
    $check(!$migrator->hasLedger(), 'signed key refusal created a migration ledger');
    $check($db->run("SHOW TABLES LIKE '$bookmarks'") === [], 'signed key refusal ran earlier migration DDL');
    $db->run("ALTER TABLE `$table` DROP FOREIGN KEY `sp_contacts_parentId_fk`");
    $db->run("ALTER TABLE `$table` MODIFY `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, MODIFY `parentId` BIGINT UNSIGNED NULL");
    $db->run("ALTER TABLE `$table` ADD CONSTRAINT `sp_contacts_parentId_fk` FOREIGN KEY (`parentId`) REFERENCES `$table` (`id`) ON DELETE SET NULL");
    $applied = $migrator->migrate();
    $ids = array_map(static fn (string $path): string => basename(dirname($path)), glob("$dir/*/migration.sql") ?: []);
    $check(count($ids) === 2 && $applied === $ids, 'adoption and unique removal did not finish');
    $check($db->run("SHOW INDEX FROM `$table` WHERE Key_name = 'email_unique'") === [], 'the later migration did not remove the adopted index');
    $check($db->run('SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$table]) === [['CONSTRAINT_NAME' => 'sp_contacts_parentId_fk']], 'the later migration changed the adopted foreign key');
    $check($db->run("SELECT * FROM `$table`") === $rows, 'constraint migration changed the retained BIGINT row');
    $store = \SpacePress\Wp\CompositeStore::create($schema, $db);
    $query = \SpacePress\Sql::select($schema, $store, 'contacts', ['where' => ['active' => false]]);
    $check(array_column($db->run($query['sql'], $query['params']), 'id') === array_column($rows, 'id'), 'adopted native boolean false did not match');
    $query = \SpacePress\Sql::select($schema, $store, 'contacts', ['where' => ['active' => true]]);
    $check($db->run($query['sql'], $query['params']) === [], 'adopted native boolean false matched true');
    $check($migrator->migrate() === [], 'completed migrations were repeated');
    echo "adopted-constraint proof: nontransactional storage, wrong index names, foreign key names, referenced databases and signed keys refused without table or ledger changes; canonical constraints adopted and the unique index removed; BIGINT row retained; native boolean predicates preserved\n";
} finally {
    $db->run("DROP TABLE IF EXISTS `$bookmarks`");
    $db->run("DROP TABLE IF EXISTS `$table`");
    $db->run("DROP TABLE IF EXISTS `$otherDatabase`.`$table`");
    $db->run("DROP TABLE IF EXISTS `$ledger`");
    $db->run("DROP TABLE IF EXISTS `$revisions`");
}
