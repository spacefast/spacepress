<?php
// `wp eval` fixture for plugin.test.ts: a second app whose first migration has the same id as the
// blog's (`0001_init`) but is a different file. Runs that app's migrator, as its activation would.
// Prints [pending before, applied, whether its table now exists] as JSON, then cleans up.
declare(strict_types=1);

$db = \TypedPress\Wp\Runtime::plugin()->connection();
$dir = sys_get_temp_dir() . '/typedpress-other-' . bin2hex(random_bytes(4));
mkdir($dir);
file_put_contents("$dir/0001_init.sql", "CREATE TABLE `{prefix}tp_other_notes` (\n\t`id` BIGINT,\n\tPRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
$other = new \TypedPress\Wp\Migrator($db, $dir, new \TypedPress\Schema(['version' => 5, 'runtime' => \TypedPress\Wp\Runtime::SERIES, 'name' => 'other']));

$pending = $other->pending();
$applied = $other->migrate();
$table = $db->run("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wp_tp_other_notes'") !== [];

$db->run("DELETE FROM wp_tp__migrations WHERE app = 'other'");
$db->run('DROP TABLE IF EXISTS wp_tp_other_notes');
unlink("$dir/0001_init.sql");
rmdir($dir);
echo wp_json_encode([$pending, $applied, $table]);
