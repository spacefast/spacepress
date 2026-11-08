<?php
declare(strict_types=1);
namespace Zero;
final class JsObject
{
    public bool $nullPrototype = false;
    /**
     * Non-enumerable own string-keyed properties (an Error's message, cause and stack).
     * Enumeration, JSON, spread and cloning read only $p, so these stay invisible to them.
     */
    public array $hidden = [];

    public function __construct(public array $p = [], public readonly ?JsClass $class = null, bool $nullPrototype = false)
    {
        $this->nullPrototype = $nullPrototype;
    }
}
