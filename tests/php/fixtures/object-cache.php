<?php

declare(strict_types=1);

/*
 * A persistent object cache for the read budget (tests/php/read_budget.php): WordPress's own
 * WP_Object_Cache, with every persistent group kept in one file between requests, as Memcached
 * keeps them on a host. Copied to wp-content/object-cache.php once the site is seeded.
 *
 * `trips` counts what a cache server would be asked: a get of a key this request does not hold yet
 * is one round trip, found or not, and a get_multiple is one round trip for all of its keys. A key
 * asked for once is not asked for again in the same request, as in Automattic's wp-memcached.
 */

require_once ABSPATH . WPINC . '/class-wp-object-cache.php';

final class TP_Test_Object_Cache extends WP_Object_Cache
{
    /** @var array{single: int, multi: int, keys: int, log?: list<string>} round trips a cache server would see */
    public array $trips = ['single' => 0, 'multi' => 0, 'keys' => 0];
    /** @var array<string, array{mixed, int}> group\0key => [value, expiry (0: never)] */
    private array $stored = [];
    /** @var array<string, true> */
    private array $asked = [];
    /** @var array<string, array{mixed, int}> */
    private array $dirty = [];
    /** @var array<string, true> */
    private array $gone = [];
    /** @var array<string, true> */
    private array $local = [];
    private bool $flushed = false;
    private bool $saved = false;
    private string $file;

    public function __construct()
    {
        parent::__construct();
        $this->file = WP_CONTENT_DIR . '/object-cache.data';
        $data = is_file($this->file) ? @unserialize((string) file_get_contents($this->file)) : [];
        $this->stored = is_array($data) ? $data : [];
        register_shutdown_function([$this, 'save']);
    }

    public function add_non_persistent_groups($groups): void
    {
        $this->local += array_fill_keys((array) $groups, true);
    }

    private function name(int|string $key, string $group): string
    {
        return ($group === '' ? 'default' : $group) . "\0" . $key;
    }

    /** Take $key from the server into this request's memory. False when nothing needed asking. */
    private function pull(int|string $key, string $group): bool
    {
        $group = $group === '' ? 'default' : $group;
        $name = $this->name($key, $group);
        if (isset($this->local[$group]) || isset($this->asked[$name]) || $this->_exists($key, $group)) {
            return false;
        }
        $this->asked[$name] = true;
        $entry = $this->stored[$name] ?? null;
        if ($entry !== null && ($entry[1] === 0 || $entry[1] > time())) {
            parent::set($key, $entry[0], $group);
        }

        return true;
    }

    public function get($key, $group = 'default', $force = false, &$found = null)
    {
        if ($this->pull($key, (string) $group)) {
            $this->trips['single']++;
            if (isset($_SERVER['HTTP_X_TP_READ_BUDGET_TRACE'])) {
                $this->trips['log'][] = "$group:$key <- " . substr(wp_debug_backtrace_summary(null, 2), -150);
            }
        }

        return parent::get($key, $group, $force, $found);
    }

    public function get_multiple($keys, $group = 'default', $force = false)
    {
        $asked = 0;
        foreach ($keys as $key) {
            $asked += (int) $this->pull($key, (string) $group);
        }
        if ($asked > 0) {
            $this->trips['multi']++;
            $this->trips['keys'] += $asked;
        }
        $out = [];
        foreach ($keys as $key) {
            $out[$key] = parent::get($key, $group, $force);
        }

        return $out;
    }

    public function add($key, $data, $group = 'default', $expire = 0)
    {
        $this->pull($key, (string) $group);
        $done = parent::add($key, $data, $group, $expire);
        if ($done) {
            $this->keep($key, (string) $group, $data, (int) $expire);
        }

        return $done;
    }

    public function replace($key, $data, $group = 'default', $expire = 0)
    {
        $this->pull($key, (string) $group);
        $done = parent::replace($key, $data, $group, $expire);
        if ($done) {
            $this->keep($key, (string) $group, $data, (int) $expire);
        }

        return $done;
    }

    public function set($key, $data, $group = 'default', $expire = 0)
    {
        $done = parent::set($key, $data, $group, $expire);
        $this->keep($key, (string) $group, $data, (int) $expire);

        return $done;
    }

    private function keep(int|string $key, string $group, mixed $data, int $expire): void
    {
        $group = $group === '' ? 'default' : $group;
        if (isset($this->local[$group])) {
            return;
        }
        $name = $this->name($key, $group);
        $this->dirty[$name] = [is_object($data) ? clone $data : $data, $expire > 0 ? time() + $expire : 0];
        $this->asked[$name] = true;
        unset($this->gone[$name]);
        // A cache server stores a value when it is set; this one writes at shutdown, so a value a
        // later shutdown function sets is written at once.
        if ($this->saved) {
            $this->save();
        }
    }

    public function delete($key, $group = 'default', $deprecated = false)
    {
        $name = $this->name($key, (string) $group);
        $this->gone[$name] = true;
        $this->asked[$name] = true;
        unset($this->dirty[$name]);
        parent::delete($key, $group);
        if ($this->saved) {
            $this->save();
        }

        return true;
    }

    public function flush()
    {
        $this->flushed = true;
        $this->dirty = $this->gone = [];

        return parent::flush();
    }

    /** This request's memory only: the server keeps what it holds, and is asked again. */
    public function flush_runtime(): bool
    {
        $this->asked = [];

        return parent::flush();
    }

    public function flush_group($group)
    {
        $prefix = ((string) $group === '' ? 'default' : (string) $group) . "\0";
        foreach ([...array_keys($this->stored), ...array_keys($this->dirty)] as $name) {
            if (str_starts_with((string) $name, $prefix)) {
                $this->gone[$name] = true;
                unset($this->dirty[$name]);
            }
        }
        $this->stored = array_diff_key($this->stored, $this->gone);

        return parent::flush_group($group);
    }

    public function save(): void
    {
        $this->saved = true;
        if (!$this->flushed && $this->dirty === [] && $this->gone === []) {
            return;
        }
        $lock = fopen($this->file . '.lock', 'c');
        flock($lock, LOCK_EX);
        $data = $this->flushed || !is_file($this->file) ? [] : (@unserialize((string) file_get_contents($this->file)) ?: []);
        $data = array_diff_key($data, $this->gone);
        foreach ($this->dirty as $name => $entry) {
            $data[$name] = $entry;
        }
        try {
            file_put_contents($this->file, serialize($data));
        } catch (\Throwable) {
            // A value that can't be serialized (a closure) stays in this request only.
        }
        flock($lock, LOCK_UN);
        $this->dirty = $this->gone = [];
        $this->flushed = false;
    }
}

function wp_cache_init(): void
{
    $GLOBALS['wp_object_cache'] = new TP_Test_Object_Cache();
}
function wp_cache_add($key, $data, $group = '', $expire = 0)
{
    return $GLOBALS['wp_object_cache']->add($key, $data, $group, (int) $expire);
}
function wp_cache_add_multiple(array $data, $group = '', $expire = 0)
{
    return $GLOBALS['wp_object_cache']->add_multiple($data, $group, $expire);
}
function wp_cache_replace($key, $data, $group = '', $expire = 0)
{
    return $GLOBALS['wp_object_cache']->replace($key, $data, $group, (int) $expire);
}
function wp_cache_set($key, $data, $group = '', $expire = 0)
{
    return $GLOBALS['wp_object_cache']->set($key, $data, $group, (int) $expire);
}
function wp_cache_set_multiple(array $data, $group = '', $expire = 0)
{
    return $GLOBALS['wp_object_cache']->set_multiple($data, $group, $expire);
}
function wp_cache_get($key, $group = '', $force = false, &$found = null)
{
    return $GLOBALS['wp_object_cache']->get($key, $group, $force, $found);
}
function wp_cache_get_multiple($keys, $group = '', $force = false)
{
    return $GLOBALS['wp_object_cache']->get_multiple($keys, $group, $force);
}
function wp_cache_delete($key, $group = '')
{
    return $GLOBALS['wp_object_cache']->delete($key, $group);
}
function wp_cache_delete_multiple(array $keys, $group = '')
{
    return $GLOBALS['wp_object_cache']->delete_multiple($keys, $group);
}
function wp_cache_incr($key, $offset = 1, $group = '')
{
    return $GLOBALS['wp_object_cache']->incr($key, $offset, $group);
}
function wp_cache_decr($key, $offset = 1, $group = '')
{
    return $GLOBALS['wp_object_cache']->decr($key, $offset, $group);
}
function wp_cache_flush()
{
    return $GLOBALS['wp_object_cache']->flush();
}
function wp_cache_flush_runtime()
{
    return $GLOBALS['wp_object_cache']->flush_runtime();
}
function wp_cache_flush_group($group)
{
    return $GLOBALS['wp_object_cache']->flush_group($group);
}
function wp_cache_supports($feature)
{
    return in_array($feature, ['add_multiple', 'set_multiple', 'get_multiple', 'delete_multiple', 'flush_runtime', 'flush_group'], true);
}
function wp_cache_close()
{
    return true;
}
function wp_cache_add_global_groups($groups)
{
    $GLOBALS['wp_object_cache']->add_global_groups($groups);
}
function wp_cache_add_non_persistent_groups($groups)
{
    $GLOBALS['wp_object_cache']->add_non_persistent_groups($groups);
}
function wp_cache_switch_to_blog($blog_id)
{
    $GLOBALS['wp_object_cache']->switch_to_blog($blog_id);
}
function wp_cache_reset()
{
    $GLOBALS['wp_object_cache']->reset();
}
