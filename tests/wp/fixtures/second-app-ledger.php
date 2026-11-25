<?php
// `wp eval` fixture for plugin.test.ts: a second app whose first migration has the same id as the
// blog's but is a different file. Runs that app's migrator, as its activation would.
// Prints [pending before, applied, whether its table now exists] as JSON, then cleans up.
declare(strict_types=1);

$blog = \SpacePress\Wp\Runtime::plugin();
$db = $blog->connection();
$initial = glob($blog->dir . '/sp/app/migrations/*_init/migration.sql')[0] ?? throw new \RuntimeException('No blog init migration');
$id = basename(dirname($initial));
$dir = sys_get_temp_dir() . '/spacepress-other-' . bin2hex(random_bytes(4));
mkdir("$dir/$id", 0777, true);
file_put_contents("$dir/$id/migration.sql", "CREATE TABLE `{prefix}sp_other_notes` (\n\t`id` BIGINT,\n\tPRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
$other = new \SpacePress\Wp\Migrator($db, $dir, new \SpacePress\Schema(['version' => 5, 'runtime' => \SpacePress\Wp\Runtime::SERIES, 'name' => 'other']));

$pending = $other->pending();
$applied = $other->migrate();
$table = $db->run("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wp_sp_other_notes'") !== [];

$db->run("DELETE FROM wp_sp__migrations WHERE app = 'other'");
$db->run('DROP TABLE IF EXISTS wp_sp_other_notes');
unlink("$dir/$id/migration.sql");
rmdir("$dir/$id");
rmdir($dir);
echo wp_json_encode([$pending, $applied, $table]);
