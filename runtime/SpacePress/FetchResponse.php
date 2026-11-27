<?php

declare(strict_types=1);

namespace SpacePress;

/**
 * What `await fetch(...)` returns: the WHATWG Response fields a handler reads. The body was read
 * in full before the call returned; `text()` and `json()` may consume it once, as in fetch.
 */
final class FetchResponse implements \JsonSerializable, \Stringable
{
    public readonly bool $ok;
    private bool $used = false;

    public function __construct(
        public readonly int $status,
        public readonly string $statusText,
        public readonly string $url,
        public readonly bool $redirected,
        public readonly FetchHeaders $headers,
        private readonly string $body,
    ) {
        $this->ok = $status >= 200 && $status <= 299;
    }

    public function bodyUsed(): bool
    {
        return $this->used;
    }

    public function text(): string
    {
        if ($this->used) {
            throw new JsError('Body is unusable: Body has already been read', 'TypeError');
        }
        $this->used = true;

        return $this->body;
    }

    public function json(): mixed
    {
        return Js::jsonParse($this->text());
    }

    public function jsonSerialize(): \stdClass
    {
        return new \stdClass();
    }

    public function __toString(): string
    {
        return '[object Response]';
    }

    /** `Response.json(data, init?)` in route handlers. */
    public static function fromJson(mixed $data, mixed $init = null): self
    {
        $body = Js::jsonStringify(JsBinary::refuseWire($data, 'Response.json')) ?? 'null';
        $resp = self::from($body, $init);
        if (!$resp->headers->has('content-type')) {
            $resp->headers->set('content-type', 'application/json; charset=utf-8');
        }

        return $resp;
    }

    /** `new Response(body?, init?)` in route handlers. */
    public static function from(string $body = '', mixed $init = null): self
    {
        $initArr = is_array($init) ? $init : ($init instanceof JsObject ? $init->p : []);
        $status = $initArr['status'] ?? 200;
        if ($status === JsUndefined::Value) {
            $status = 200;
        }
        $status = (int) $status;
        $statusText = $initArr['statusText'] ?? '';
        if ($statusText === JsUndefined::Value) {
            $statusText = '';
        }
        $rawHeaders = $initArr['headers'] ?? null;
        if ($rawHeaders === JsUndefined::Value) {
            $rawHeaders = null;
        }
        $headers = $rawHeaders instanceof FetchHeaders
            ? $rawHeaders
            : new FetchHeaders($rawHeaders);

        return new self($status, (string) $statusText, '', false, $headers, $body);
    }

    /** Raw body + headers array for App::routeResponse(). */
    public function toRouteArray(): array
    {
        $headers = [];
        foreach ($this->headers->entries() as $entry) {
            $headers[$entry->a[0]] = $entry->a[1];
        }

        return [
            'status' => $this->status,
            'headers' => $headers,
            'body' => $this->body,
        ];
    }
}
