<?php
declare(strict_types=1);
namespace SpacePress\Node;

use SpacePress\Js;
use SpacePress\JsArray;
use SpacePress\JsError;
use SpacePress\JsUndefined;

/**
 * A Node built-in module (`node:crypto`, `node:buffer`, ...) as a run-time namespace object. The
 * compiler emits `Module::get('crypto')->member('createHash')` and `->call('createHash', [...])`.
 * Exports are registered once per request, the first time a module is reached.
 */
final class Module implements Dispatch
{
    /** Bare module name => the classes whose `exports()` make up the module, in order. */
    private const MODULES = [
        'crypto' => [Crypto::class],
        'buffer' => [Buffer::class],
    ];

    /** @var array<string, self> */
    private static array $modules = [];
    /** @var array<string, array<string, mixed>> */
    private static array $members = [];
    /** @var array<string, \Closure> */
    private static array $methods = [];

    private function __construct(public readonly string $name) {}

    public static function get(string $name): self
    {
        if (!isset(self::$modules[$name])) {
            if (!isset(self::MODULES[$name])) {
                throw JsError::node("No such built-in module: node:$name", 'Error', 'ERR_UNKNOWN_BUILTIN_MODULE');
            }
            self::$modules[$name] = new self($name);
            foreach (self::MODULES[$name] as $class) {
                self::register($name, $class::exports());
            }
        }
        return self::$modules[$name];
    }

    /** Adds exports to a module: an export name => a \Closure (a function) or a value. */
    public static function register(string $name, array $members): void
    {
        self::$members[$name] = (self::$members[$name] ?? []) + $members;
    }

    public function member(string $key): mixed
    {
        return array_key_exists($key, self::$members[$this->name]) ? self::$members[$this->name][$key] : JsUndefined::Value;
    }

    public function call(string $key, array $args): mixed
    {
        $member = $this->member($key);
        if (!$member instanceof \Closure) {
            if ($key === 'toString' || $key === 'valueOf') { return self::inherited($this, $key); }
            throw new JsError("$this->name.$key is not a function", 'TypeError');
        }
        return $member(...$args);
    }

    public function read(string $key): mixed { return $this->member($key); }

    public function invoke(string $name, array $args): mixed { return $this->call($name, $args); }

    /** @return list<string> */
    public function keys(): array { return array_keys(self::$members[$this->name]); }

    /**
     * One function value per method name, like a prototype method: called as a method it receives
     * its receiver, and `$call($receiver, $args)` checks the receiver itself.
     */
    public static function method(string $key, \Closure $call): \Closure
    {
        if (!isset(self::$methods[$key])) {
            $invoke = static fn (mixed $thisArg, JsArray $args): mixed => $call($thisArg, $args->a);
            self::$methods[$key] = Js::dynamicMethodFunction(static fn (...$args) => $invoke(JsUndefined::Value, new JsArray($args)), $invoke);
        }
        return self::$methods[$key];
    }

    /** Object.prototype's toString and valueOf, which every Node object inherits. */
    public static function inherited(object $receiver, string $name): mixed
    {
        return match ($name) {
            'toString' => Js::dynamicObjectTag($receiver),
            'valueOf' => $receiver,
            default => throw new JsError($name . ' is not a function', 'TypeError'),
        };
    }
}
