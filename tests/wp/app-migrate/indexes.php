<?php
declare(strict_types=1);

$plugin = \First\Wp\Runtime::plugin();
$wpdb = clone $plugin->connection()->wpdb();
$wpdb->set_prefix('adopt_');
$db = new \First\Wp\Connection($wpdb);
$schema = \First\Schema::load('/tmp/first-app-migrate-indexes/first/app/schema.php');
$dir = '/tmp/first-app-migrate-indexes/first/app/migrations';
// The second migration drops parentId's reference, which changes its type on a table Zero didn't
// create: the schema check refuses that until the deploy confirms it, as a real one would.
$migrator = new \First\Wp\Migrator($db, $dir, $schema, drops: \First\Wp\SchemaCheck::drops(['contacts.parentId=0']));
$ledger = $db->prefix() . 'first__migrations';
$table = 'adopt_legacy_contacts';
$otherDatabase = 'first_adopt_other';
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
    $check(!$migrator->keyed(), 'refused storage engine created a migration ledger');
    $check($db->run("SHOW TABLES LIKE 'adopt_zero_bookmarks'") === [], 'refused storage engine ran earlier migration DDL');
    $db->run("ALTER TABLE `$table` ENGINE=InnoDB");
    $db->run("ALTER TABLE `$table` ADD CONSTRAINT `old_parent_fk` FOREIGN KEY (`parentId`) REFERENCES `$table` (`id`) ON DELETE SET NULL");
    $ddl = $db->run("SHOW CREATE TABLE `$table`");
    $check(!$migrator->keyed(), 'fixture already has a migration ledger');
    try {
        $migrator->migrate();
        throw new \LogicException('adoption accepted an index name absent from its snapshot');
    } catch (\RuntimeException $e) {
        $check(str_contains($e->getMessage(), 'Cannot adopt adopt_legacy_contacts: index email_unique'), $e->getMessage());
    }
    $check($db->run("SHOW CREATE TABLE `$table`") === $ddl, 'refused adoption changed the table');
    $check(!$migrator->keyed(), 'refused adoption created a migration ledger');
    $check($db->run("SHOW TABLES LIKE 'adopt_zero_bookmarks'") === [], 'refused adoption ran earlier migration DDL');
    $db->run("ALTER TABLE `$table` RENAME INDEX `old_email_key` TO `email_unique`");
    $ddl = $db->run("SHOW CREATE TABLE `$table`");
    try {
        $migrator->migrate();
        throw new \LogicException('adoption accepted a foreign key name absent from its snapshot');
    } catch (\RuntimeException $e) {
        $check(str_contains($e->getMessage(), 'foreign key first_contacts_parentId_fk'), $e->getMessage());
    }
    $check($db->run("SHOW CREATE TABLE `$table`") === $ddl, 'refused foreign key adoption changed the table');
    $check(!$migrator->keyed(), 'refused foreign key adoption created a migration ledger');
    $db->run("CREATE TABLE `$otherDatabase`.`$table` (`id` BIGINT UNSIGNED NOT NULL PRIMARY KEY) ENGINE=InnoDB");
    $db->run("ALTER TABLE `$table` DROP FOREIGN KEY `old_parent_fk`, ADD CONSTRAINT `first_contacts_parentId_fk` FOREIGN KEY (`parentId`) REFERENCES `$otherDatabase`.`$table` (`id`) ON DELETE SET NULL");
    $ddl = $db->run("SHOW CREATE TABLE `$table`");
    try {
        $migrator->migrate();
        throw new \LogicException('adoption accepted a foreign key targeting another database');
    } catch (\RuntimeException $e) {
        $check(str_contains($e->getMessage(), 'foreign key first_contacts_parentId_fk'), $e->getMessage());
    }
    $check($db->run("SHOW CREATE TABLE `$table`") === $ddl, 'cross-database adoption changed the table');
    $check(!$migrator->keyed(), 'cross-database adoption created a migration ledger');
    $check($db->run("SHOW TABLES LIKE 'adopt_zero_bookmarks'") === [], 'cross-database adoption ran earlier migration DDL');
    $db->run("ALTER TABLE `$table` DROP FOREIGN KEY `first_contacts_parentId_fk`");
    $db->run("ALTER TABLE `$table` MODIFY `id` BIGINT NOT NULL AUTO_INCREMENT, MODIFY `parentId` BIGINT NULL");
    $db->run("ALTER TABLE `$table` ADD CONSTRAINT `first_contacts_parentId_fk` FOREIGN KEY (`parentId`) REFERENCES `$table` (`id`) ON DELETE SET NULL");
    $ddl = $db->run("SHOW CREATE TABLE `$table`");
    try {
        $migrator->migrate();
        throw new \LogicException('adoption accepted signed keys for an unsigned foreign key');
    } catch (\RuntimeException $e) {
        $check(str_contains($e->getMessage(), 'column id must use BIGINT UNSIGNED'), $e->getMessage());
    }
    $check($db->run("SHOW CREATE TABLE `$table`") === $ddl, 'signed key refusal changed the table');
    $check(!$migrator->keyed(), 'signed key refusal created a migration ledger');
    $check($db->run("SHOW TABLES LIKE 'adopt_zero_bookmarks'") === [], 'signed key refusal ran earlier migration DDL');
    $db->run("ALTER TABLE `$table` DROP FOREIGN KEY `first_contacts_parentId_fk`");
    $db->run("ALTER TABLE `$table` MODIFY `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, MODIFY `parentId` BIGINT UNSIGNED NULL");
    $db->run("ALTER TABLE `$table` ADD CONSTRAINT `first_contacts_parentId_fk` FOREIGN KEY (`parentId`) REFERENCES `$table` (`id`) ON DELETE SET NULL");
    $applied = $migrator->migrate();
    $check($applied === ['0001_init', '0002_update'], 'adoption and unique removal did not finish');
    $check($db->run("SHOW INDEX FROM `$table` WHERE Key_name = 'email_unique'") === [], 'the later migration did not remove the adopted index');
    $check($db->run('SELECT * FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$table]) === [], 'the later migration did not remove the adopted foreign key');
    $check($db->run("SELECT * FROM `$table`") === $rows, 'constraint migration changed the retained BIGINT row');
    $store = \First\Wp\CompositeStore::create($schema, $db);
    $query = \First\Sql::select($schema, $store, 'contacts', ['where' => ['active' => false]]);
    $check(array_column($db->run($query['sql'], $query['params']), 'id') === array_column($rows, 'id'), 'adopted native boolean false did not match');
    $query = \First\Sql::select($schema, $store, 'contacts', ['where' => ['active' => true]]);
    $check($db->run($query['sql'], $query['params']) === [], 'adopted native boolean false matched true');
    $check($migrator->migrate() === [], 'completed migrations were repeated');
    echo "adopted-constraint proof: nontransactional storage, wrong index names, foreign key names, referenced databases and signed keys refused without table or ledger changes; canonical constraints adopted then removed; BIGINT row retained; native boolean predicates preserved\n";
} finally {
    $db->run("DROP TABLE IF EXISTS `$table`");
    $db->run("DROP TABLE IF EXISTS `$otherDatabase`.`$table`");
    $db->run("DROP TABLE IF EXISTS `$ledger`");
    $db->run('DROP TABLE IF EXISTS adopt_zero__revisions');
    $db->run('DROP TABLE IF EXISTS adopt_zero_bookmarks');
}
