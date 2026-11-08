<?php

declare(strict_types=1);

namespace Zero;

/**
 * A thrown value that is not a built-in JsError, such as an instance of `class E extends Error`
 * or a plain object. PHP can only throw Throwables, so the value travels inside this exception
 * and `catch` binds the original value again (Js::caught).
 */
final class JsThrown extends JsError
{
    public readonly mixed $value;

    public function __construct(mixed $value)
    {
        $this->value = $value;
        [$name, $message] = self::describe($value);
        parent::__construct($message, $name);
    }

    /** The name and message an uncaught value reports, read like Error.prototype.toString. */
    private static function describe(mixed $value): array
    {
        try {
            if ($value instanceof JsObject && $value->class?->builtinRoot() !== null) {
                $name = Js::dynamicGet($value, 'name');
                $message = Js::dynamicGet($value, 'message');
                return [$name === JsUndefined::Value ? 'Error' : Js::str($name), $message === JsUndefined::Value ? '' : Js::str($message)];
            }
            return ['Error', 'Uncaught ' . Js::str($value)];
        } catch (\Throwable) {
            return ['Error', 'Uncaught exception'];
        }
    }

    public function __serialize(): array
    {
        return [$this->getMessage(), $this->jsName, true];
    }

    /** Receipt snapshots keep the JS-visible name and message; the thrown value is not persisted. */
    public function __unserialize(array $data): void
    {
        JsError::__construct($data[0], $data[1], $data[2] ?? true);
        $this->value = new JsError($data[0], $data[1], $data[2] ?? true);
    }
}
