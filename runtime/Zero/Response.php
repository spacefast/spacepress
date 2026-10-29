<?php

declare(strict_types=1);

namespace Zero;

/** An operation result, before either transport emits it. Streaming starts only after commit. */
final class Response
{
    private function __construct(
        public readonly int $status,
        public readonly mixed $data,
        public readonly array $headers,
        public readonly string|\Closure|null $body,
    ) {
    }

    public static function json(mixed $data, int $status = 200, array $headers = []): self
    {
        return new self($status, $data, $headers, null);
    }

    /** A raw string or deferred emitter; the emitter must not perform database mutations. */
    public static function raw(string|\Closure $body, int $status = 200, array $headers = []): self
    {
        return new self($status, null, $headers, $body);
    }

    public function withHeaders(array $headers): self
    {
        return new self($this->status, $this->data, $headers + $this->headers, $this->body);
    }

    /** @return array{int, array<string, string>, string|\Closure} */
    public function http(): array
    {
        return [$this->status, $this->headers + ['Content-Type' => $this->body === null ? 'application/json' : 'application/octet-stream'],
            $this->body ?? (Js::jsonStringify(['data' => $this->data]) ?? '{}')];
    }

    public static function emit(string|\Closure $body): void
    {
        if ($body instanceof \Closure) {
            $body();
        } else {
            echo $body;
        }
    }
}
