<?php
declare(strict_types=1);

$plugin = \Zero\Wp\Runtime::plugin();
$wpdb = clone $plugin->connection()->wpdb();
$wpdb->set_prefix('adopt_');
$db = new \Zero\Wp\Connection($wpdb);
$schema = \Zero\Schema::load('/tmp/zero-app-migrate-indexes/zero/app/schema.php');
$dir = '/tmp/zero-app-migrate-indexes/zero/app/migrations';
$migrator = new \Zero\Wp\Migrator($db, $dir, $schema);
$ledger = $db->prefix() . 'zero__migrations';
$table = 'sf_migrate_index_contacts';
$check = static function (bool $ok, string $message): void {
    if (!$ok) { throw new \RuntimeException($message); }
};
try {
    $db->run("CREATE TABLE `$table` (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `email` VARCHAR(191), `active` TINYINT(1) DEFAULT 0, `parentId` BIGINT UNSIGNED NULL, PRIMARY KEY (`id`), UNIQUE KEY `old_email_key` (`email`), CONSTRAINT `old_parent_fk` FOREIGN KEY (`parentId`) REFERENCES `$table` (`id`) ON DELETE SET NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $db->run("INSERT INTO `$table` (`id`, `email`) VALUES (9007199254740991, 'retained@example.test')");
    $rows = $db->run("SELECT * FROM `$table`");
    $ddl = $db->run("SHOW CREATE TABLE `$table`");
    $check(!$migrator->keyed(), 'fixture already has a migration ledger');
    try {
        $migrator->migrate();
        throw new \LogicException('adoption accepted an index name absent from its snapshot');
    } catch (\RuntimeException $e) {
        $check(str_contains($e->getMessage(), 'Cannot adopt sf_migrate_index_contacts: index email_unique'), $e->getMessage());
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
        $check(str_contains($e->getMessage(), 'foreign key zero_contacts_parentId_fk'), $e->getMessage());
    }
    $check($db->run("SHOW CREATE TABLE `$table`") === $ddl, 'refused foreign key adoption changed the table');
    $check(!$migrator->keyed(), 'refused foreign key adoption created a migration ledger');
    $db->run("ALTER TABLE `$table` DROP FOREIGN KEY `old_parent_fk`, ADD CONSTRAINT `zero_contacts_parentId_fk` FOREIGN KEY (`parentId`) REFERENCES `$table` (`id`) ON DELETE SET NULL");
    $applied = $migrator->migrate();
    $check($applied === ['0001_init', '0002_update'], 'adoption and unique removal did not finish');
    $check($db->run("SHOW INDEX FROM `$table` WHERE Key_name = 'email_unique'") === [], 'the later migration did not remove the adopted index');
    $check($db->run('SELECT * FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$table]) === [], 'the later migration did not remove the adopted foreign key');
    $check($db->run("SELECT * FROM `$table`") === $rows, 'constraint migration changed the retained BIGINT row');
    $store = \Zero\Wp\CompositeStore::create($schema, $db);
    $query = \Zero\Sql::select($schema, $store, 'contacts', ['where' => ['active' => false]]);
    $check(array_column($db->run($query['sql'], $query['params']), 'id') === array_column($rows, 'id'), 'adopted native boolean false did not match');
    $query = \Zero\Sql::select($schema, $store, 'contacts', ['where' => ['active' => true]]);
    $check($db->run($query['sql'], $query['params']) === [], 'adopted native boolean false matched true');
    $check($migrator->migrate() === [], 'completed migrations were repeated');
    echo "adopted-constraint proof: wrong index and foreign key names refused without table or ledger changes; canonical constraints adopted then removed; BIGINT row retained; native boolean predicates preserved\n";
} finally {
    $db->run("DROP TABLE IF EXISTS `$table`");
    $db->run("DROP TABLE IF EXISTS `$ledger`");
    $db->run('DROP TABLE IF EXISTS adopt_zero__revisions');
    $db->run('DROP TABLE IF EXISTS adopt_zero_bookmarks');
}
