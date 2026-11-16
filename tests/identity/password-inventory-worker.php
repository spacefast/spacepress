<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
$input = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
echo TypedPress\Identity\Plugin::$db->row('SELECT CONNECTION_ID() AS id')['id'] . "\n";
flush();
if ($input['crash'] ?? false) {
    // A real shared option cache survives this process. Only the progress key is persisted.
    $GLOBALS['wp_object_cache'] = new class($input['cache']) extends WP_Object_Cache {
        public function __construct(private string $inventoryCacheFile) { parent::__construct(); }
        public function set($key, $data, $group = 'default', $expire = 0) {
            if ($group === 'options' && $key === 'tp_identity_password_inventory') {
                file_put_contents($this->inventoryCacheFile, serialize($data), LOCK_EX);
            }
            return parent::set($key, $data, $group, $expire);
        }
        public function get($key, $group = 'default', $force = false, &$found = null) {
            if ($group === 'options' && $key === 'tp_identity_password_inventory' && is_file($this->inventoryCacheFile)) {
                $found = true;
                return unserialize(file_get_contents($this->inventoryCacheFile), ['allowed_classes' => false]);
            }
            return parent::get($key, $group, $force, $found);
        }
        public function delete($key, $group = 'default', $deprecated = false) {
            if ($group === 'options' && $key === 'tp_identity_password_inventory' && is_file($this->inventoryCacheFile)) {
                unlink($this->inventoryCacheFile);
            }
            return parent::delete($key, $group, $deprecated);
        }
    };
    add_filter('query', static function ($sql) {
        if (strtoupper(trim($sql)) === 'COMMIT') {
            // All writes and cache side effects have run; the connection dies before commit.
            exit(9);
        }
        return $sql;
    });
}
do_action('tp_identity_password_inventory');
echo "completed\n";
