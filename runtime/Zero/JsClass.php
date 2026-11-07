<?php
declare(strict_types=1);
namespace Zero;

/**
 * Descriptors carry dispatch identity; instance own properties stay in JsObject.
 *
 * Private names (`#x`) belong to one class evaluation, as in JavaScript: each
 * descriptor keeps its own brand table from receiver to private slots. Private
 * state never enters JsObject::$p, so enumeration, JSON and cloning cannot see it.
 */
final class JsClass
{
    /** @var \WeakMap<JsObject, array<string, mixed>>|null */
    private ?\WeakMap $brands = null;
    /** @var array<string, \Closure> */
    private array $methodValues = [];

    public function __construct(
        public readonly ?self $parent,
        private readonly ?\Closure $constructor,
        private readonly \Closure $fields,
        private readonly array $methods,
        private readonly array $staticMethods,
        public readonly JsObject $statics,
        private readonly array $privateMethods = [],
        private readonly array $staticPrivateMethods = [],
        private readonly ?JsObject $privateStatics = null,
    ) {}

    public function construct(mixed ...$args): JsObject
    {
        $instance = new JsObject([], $this);
        $this->initialize($instance, $args);
        return $instance;
    }

    public function initialize(JsObject $instance, array $args): void
    {
        if ($this->constructor !== null) {
            if ($this->parent === null) { ($this->fields)($instance, $this); }
            ($this->constructor)($instance, ...$args);
        } else {
            $this->parent?->initialize($instance, $args);
            ($this->fields)($instance, $this);
        }
    }

    public function hasMethod(string $name): bool
    {
        return isset($this->methods[$name]) || ($this->parent?->hasMethod($name) ?? false);
    }

    public function hasStaticMethod(string $name): bool
    {
        return isset($this->staticMethods[$name]) || ($this->parent?->hasStaticMethod($name) ?? false);
    }

    private function method(string $name, bool $static): \Closure
    {
        $method = ($static ? $this->staticMethods : $this->methods)[$name] ?? null;
        if ($method !== null) { return $method; }
        if ($this->parent !== null) { return $this->parent->method($name, $static); }
        throw new JsError("Unknown class method $name", 'TypeError');
    }

    /** One function identity per class and member, like a prototype method; call/apply supply the receiver. */
    public function methodValue(string $name, bool $static): \Closure
    {
        // Inherited members share the declaring class's function, as with one prototype.
        if (!isset(($static ? $this->staticMethods : $this->methods)[$name]) && $this->parent !== null) {
            return $this->parent->methodValue($name, $static);
        }
        $key = ($static ? 'static:' : '') . $name;
        if (!isset($this->methodValues[$key])) {
            $method = $this->method($name, $static);
            $this->methodValues[$key] = Js::dynamicMethodFunction(
                static fn (...$args) => $method(JsUndefined::Value, ...$args),
                static fn ($thisArg, JsArray $args) => $method($thisArg, ...$args->a),
            );
        }
        return $this->methodValues[$key];
    }

    public function invokeOn(JsObject|self $receiver, string $name, array $args, bool $static): mixed
    {
        return ($this->method($name, $static))($receiver, ...$args);
    }

    public static function invoke(JsObject|self $receiver, string $name, array $args, bool $static): mixed
    {
        $class = $receiver instanceof self ? $receiver : $receiver->class;
        if ($class === null) { throw new JsError('Method receiver has no class', 'TypeError'); }
        return $class->invokeOn($receiver, $name, $args, $static);
    }

    public function get(string $key): mixed
    {
        if (array_key_exists($key, $this->statics->p)) { return $this->statics->p[$key]; }
        return $this->parent?->get($key);
    }

    public function has(string $key): bool
    {
        return array_key_exists($key, $this->statics->p) || ($this->parent?->has($key) ?? false);
    }

    public function set(string $key, mixed $value): mixed
    {
        $this->statics->p[$key] = $value;
        return $value;
    }

    public static function isInstance(mixed $value, self $expected): bool
    {
        if (!$value instanceof JsObject) { return false; }
        for ($class = $value->class; $class !== null; $class = $class->parent) {
            if ($class === $expected) { return true; }
        }
        return false;
    }

    /** Adds this class's brand when its field initialization starts (spec: InitializeInstanceElements). */
    public function brand(JsObject $instance): void
    {
        $this->brands ??= new \WeakMap();
        if (isset($this->brands[$instance])) {
            throw new JsError('Cannot initialize private methods of class twice on the same object', 'TypeError');
        }
        $this->brands[$instance] = [];
    }

    /** Defines a private field after its initializer ran (spec: PrivateFieldAdd). */
    public function privateDefine(JsObject $instance, string $name, mixed $value): void
    {
        $slots = $this->brands[$instance] ?? null;
        if ($slots === null || array_key_exists($name, $slots)) {
            throw new JsError("Cannot initialize $name twice on the same object", 'TypeError');
        }
        $this->brands[$instance][$name] = $value;
    }

    public function privateGet(mixed $receiver, string $name): mixed
    {
        if ($receiver === $this) {
            if ($this->privateStatics !== null && array_key_exists($name, $this->privateStatics->p)) { return $this->privateStatics->p[$name]; }
        } elseif ($receiver instanceof JsObject && $this->brands !== null && isset($this->brands[$receiver])
            && array_key_exists($name, $this->brands[$receiver])) {
            return $this->brands[$receiver][$name];
        }
        throw new JsError("Cannot read private member $name from an object whose class did not declare it", 'TypeError');
    }

    public function privateSet(mixed $receiver, string $name, mixed $value): mixed
    {
        if ($receiver === $this) {
            if ($this->privateStatics !== null && array_key_exists($name, $this->privateStatics->p)) {
                $this->privateStatics->p[$name] = $value;
                return $value;
            }
        } elseif ($receiver instanceof JsObject && $this->brands !== null && isset($this->brands[$receiver])
            && array_key_exists($name, $this->brands[$receiver])) {
            $this->brands[$receiver][$name] = $value;
            return $value;
        }
        throw new JsError("Cannot write private member $name to an object whose class did not declare it", 'TypeError');
    }

    public function privateCall(mixed $receiver, string $name, array $args): mixed
    {
        if ($receiver === $this) {
            $method = $this->staticPrivateMethods[$name] ?? null;
        } else {
            $method = $receiver instanceof JsObject && $this->brands !== null && isset($this->brands[$receiver])
                ? ($this->privateMethods[$name] ?? null)
                : null;
        }
        if ($method === null) {
            if ($receiver === $this || $receiver instanceof JsObject && isset($this->brands[$receiver])) {
                return Js::dynamicCall($this->privateGet($receiver, $name), new JsArray($args));
            }
            throw new JsError("Receiver must be an instance of the class that declares $name", 'TypeError');
        }
        return $method($receiver, ...$args);
    }

    /** `#x in value` (spec: PrivateElementFind on an object; primitives throw). */
    public function privateIn(mixed $value, string $name): bool
    {
        if (!is_object($value) || $value instanceof JsUndefined) {
            throw new JsError("Cannot use 'in' operator to search for '$name' in " . Js::str($value), 'TypeError');
        }
        if ($value === $this) {
            return isset($this->staticPrivateMethods[$name])
                || $this->privateStatics !== null && array_key_exists($name, $this->privateStatics->p);
        }
        if (!$value instanceof JsObject || $this->brands === null || !isset($this->brands[$value])) { return false; }
        return isset($this->privateMethods[$name]) || array_key_exists($name, $this->brands[$value]);
    }
}
