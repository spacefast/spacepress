<?php
declare(strict_types=1);
namespace SpacePress\Node;

/**
 * A Node built-in object reached through checked JavaScript dispatch (`Js::dynamicGet`,
 * `Js::dynamicCallMethod`): module objects, constructors, hashes and the other runtime objects.
 */
interface Dispatch
{
    /** A property read: a value, a method value (Module::method), or undefined. */
    public function read(string $key): mixed;

    /** A method call with its arguments. */
    public function invoke(string $name, array $args): mixed;
}
