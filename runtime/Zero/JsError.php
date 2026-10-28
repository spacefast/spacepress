<?php

declare(strict_types=1);

namespace Zero;

/** A JavaScript `Error` (or subclass, named by $jsName) thrown by compiled code or a Js helper. */
class JsError extends \Exception
{
    public function __construct(string $message, public readonly string $jsName = 'Error')
    {
        parent::__construct($message);
    }
}
