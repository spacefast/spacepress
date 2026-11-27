<?php

declare(strict_types=1);

namespace SpacePress;

/** A JavaScript `Error` (or subclass, named by $jsName) thrown by compiled code or a Js helper. */
class JsError extends \Exception
{
    /** `AggregateError.errors`: the rejection reasons, in iterable order. */
    public ?JsArray $errors = null;

    /** Node's `error.code` (`ERR_OUT_OF_RANGE`, ...), set by the Node built-in modules. */
    public ?string $nodeCode = null;

    /** A Node built-in's error: `name` and `code` as Node gives them; String(e) is `Name [code]: message`. */
    public static function node(string $message, string $name, string $code): self
    {
        $error = new self($message, $name);
        $error->nodeCode = $code;
        return $error;
    }

    public function __construct(string $message, public readonly string $jsName = 'Error', public bool $hasMessage = true)
    {
        parent::__construct($message);
    }

    /** `delete error.message`: reads fall back to Error.prototype.message, the empty string. */
    public function deleteMessage(): void
    {
        $this->message = '';
        $this->hasMessage = false;
    }

    /** Receipt snapshots persist JS-visible fields, never PHP frames containing callbacks. */
    public function __serialize(): array
    {
        return [$this->getMessage(), $this->jsName, $this->hasMessage, $this->nodeCode];
    }

    public function __unserialize(array $data): void
    {
        $this->__construct($data[0], $data[1], $data[2]);
        $this->nodeCode = $data[3] ?? null;
    }
}
