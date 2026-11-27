<?php
declare(strict_types=1);
namespace SpacePress\Node;

use SpacePress\Crypto as Limits;
use SpacePress\HttpError;
use SpacePress\JsArrayBuffer;
use SpacePress\JsError;
use SpacePress\JsUndefined;

/**
 * `createHash(algorithm)` and `createHmac(algorithm, key)`: a stateful digest over PHP's
 * `hash_init`. `update(data, inputEncoding?)` returns the same object; `digest(encoding?)` returns a
 * Buffer, or a string in a known encoding, and finalizes it. The total updated data is capped at
 * 1 MiB (a documented difference: 413 `crypto_input_too_large`).
 */
final class Hash implements Dispatch
{
    private ?\HashContext $context;
    private int $size = 0;

    public function __construct(string $algorithm, ?string $key = null)
    {
        // An empty HMAC key is zero-padded to the block size like any other, as "\0" is.
        $this->context = $key === null ? hash_init($algorithm) : hash_init($algorithm, HASH_HMAC, $key === '' ? "\0" : $key);
    }

    public function read(string $key): mixed
    {
        return in_array($key, ['update', 'digest'], true)
            ? Module::method('Hash:' . $key, static function (mixed $self, array $args) use ($key): mixed {
                if (!$self instanceof self) { throw new JsError('Illegal invocation', 'TypeError'); }
                return $self->invoke($key, $args);
            })
            : JsUndefined::Value;
    }

    public function invoke(string $name, array $args): mixed
    {
        $arg = static fn (int $i): mixed => array_key_exists($i, $args) ? $args[$i] : JsUndefined::Value;
        return match ($name) {
            'update' => $this->update($arg(0), $arg(1)),
            'digest' => $this->digest($arg(0)),
            default => Module::inherited($this, $name),
        };
    }

    public function update(mixed $data, mixed $encoding = JsUndefined::Value): self
    {
        $context = $this->live();
        if ($data instanceof JsArrayBuffer || !is_string($data) && !Buffer::isView($data)) {
            throw JsError::node('The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView', 'TypeError', 'ERR_INVALID_ARG_TYPE');
        }
        $bytes = is_string($data) ? Buffer::decode($data, Buffer::encoding($encoding) ?? 'utf8') : Buffer::bytes($data, 'data');
        $this->size += strlen($bytes);
        if ($this->size > Limits::MAX_DATA) {
            throw new HttpError(413, 'crypto_input_too_large', 'The crypto input is too large.');
        }
        hash_update($context, $bytes);
        return $this;
    }

    public function digest(mixed $encoding = JsUndefined::Value): mixed
    {
        $bytes = hash_final($this->live(), true);
        $this->context = null;
        $encoding = $encoding === JsUndefined::Value ? null : Buffer::encoding($encoding);
        return $encoding === null ? Buffer::wrap($bytes) : Buffer::encode($bytes, $encoding);
    }

    private function live(): \HashContext
    {
        return $this->context ?? throw JsError::node('Digest already called', 'Error', 'ERR_CRYPTO_HASH_FINALIZED');
    }
}
