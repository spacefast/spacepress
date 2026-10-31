<?php

declare(strict_types=1);

namespace Zero;

/**
 * The empty JS object `{}`. PHP arrays can't tell `{}` from `[]`, so an empty object that must stay
 * an object (a `{}` literal, `{}` decoded from JSON or stored in a JSON column) is this marker.
 * It reads like an empty array (no keys, every key missing, falsy-free like any JS object) and
 * encodes as `{}`. It is immutable: compiled writes into an object-typed place unwrap it to a plain
 * array first (`Js::own`), and a non-empty object is always a plain assoc array.
 *
 * @implements \ArrayAccess<array-key, mixed>
 * @implements \IteratorAggregate<array-key, mixed>
 */
final class JsObject extends \stdClass implements \ArrayAccess, \Countable, \IteratorAggregate, \JsonSerializable
{
    public function offsetExists(mixed $offset): bool
    {
        return false;
    }

    public function offsetGet(mixed $offset): mixed
    {
        return null;
    }

    public function offsetSet(mixed $offset, mixed $value): void
    {
        throw new \LogicException('JsObject is immutable; unwrap it with Js::own() before writing');
    }

    public function offsetUnset(mixed $offset): void
    {
    }

    public function count(): int
    {
        return 0;
    }

    public function getIterator(): \ArrayIterator
    {
        return new \ArrayIterator([]);
    }

    public function jsonSerialize(): \stdClass
    {
        return new \stdClass();
    }
}
