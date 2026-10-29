<?php

declare(strict_types=1);

namespace Zero\Jobs;

use Zero\HttpError;
use Zero\Js;
use Zero\Response;
use Zero\Viewer;

use function Zero\db;

/**
 * At-most-once results (§6.1): `once(key, fn)` in compiled code and the `Idempotency-Key` header on
 * creates and `idempotent: true` actions. A receipt is written in the caller's transaction, so a
 * rollback forgets it and the next attempt runs again.
 */
final class Receipts
{
    public const MAX_KEY = 64;

    /** `once(key, fn)`: scope 'fn', keyed per calling user. */
    public static function once(string $scope, mixed $key, callable $fn): mixed
    {
        if (!is_string($key)) {
            throw new \Zero\JsError('once key must be a string', 'TypeError');
        }
        $stored = self::remember($scope, self::key($key, ''), (int) (db()->actor()['id'] ?? 0), hash('sha256', ''),
            static fn (): array => ['data' => $fn()]);

        return $stored['data'] ?? null;
    }

    /** Extensions::aroundOperation: creates always, actions when `idempotent: true`. */
    public static function around(string $scope, array $spec, string $rawBody, array $headers, ?Viewer $viewer, callable $next): Response
    {
        $key = $headers['idempotency-key'] ?? null;
        if ($key === null || (str_starts_with($scope, 'action:') && !($spec['idempotent'] ?? false))) {
            return $next();
        }
        $replayed = false;
        $stored = self::remember($scope, self::key($key, '/Idempotency-Key'), (int) ($viewer?->user['id'] ?? 0), hash('sha256', $rawBody),
            static function () use ($next): array {
                $response = $next();

                return ['status' => $response->status, 'data' => $response->data];
            }, $replayed);
        $response = Response::json($stored['data'] ?? null, (int) ($stored['status'] ?? 200));

        return $replayed ? $response->withHeaders(['Idempotent-Replayed' => 'true']) : $response;
    }

    private static function key(string $key, string $pointer): string
    {
        if ($key === '' || mb_strlen($key) > self::MAX_KEY) {
            throw new HttpError(400, 'invalid_idempotency_key', 'Idempotency keys are 1 to ' . self::MAX_KEY . ' characters', $pointer === '' ? null : $pointer);
        }

        return $key;
    }

    /** @param callable(): array $run @return array the stored result */
    private static function remember(string $scope, string $key, int $userId, string $hash, callable $run, bool &$replayed = false): array
    {
        return db()->transaction(static function () use ($scope, $key, $userId, $hash, $run, &$replayed): array {
            $where = 'WHERE "scope" = ? AND "key" = ? AND "userId" = ?';
            $find = static fn () => Storage::run("SELECT \"inputHash\", \"state\", \"result\" FROM {receipts} $where" . Storage::forUpdate(), [$scope, $key, $userId])[0] ?? null;
            $existing = $find();
            if ($existing === null) {
                Storage::run(Storage::insertIgnore() . ' INTO {receipts} ("scope", "key", "userId", "inputHash", "state", "createdAt") VALUES (?, ?, ?, ?, \'started\', ?)',
                    [$scope, $key, $userId, $hash, Js::iso(Js::now())]);
                $mine = $find();
                // Another transaction committed this key between our read and insert.
                if ($mine !== null && ($mine['state'] !== 'started' || $mine['inputHash'] !== $hash)) {
                    $existing = $mine;
                }
            }
            if ($existing !== null) {
                if (!hash_equals((string) $existing['inputHash'], $hash)) {
                    throw new HttpError(409, 'idempotency_mismatch', 'This idempotency key was used with a different request');
                }
                if ($existing['state'] !== 'done') {
                    throw new HttpError(409, 'outcome_unknown', 'A request with this idempotency key started but has no recorded outcome');
                }
                $replayed = true;
                $result = Js::jsonParse((string) $existing['result']);

                return is_array($result) ? $result : [];
            }
            $result = $run();
            Storage::run("UPDATE {receipts} SET \"state\" = 'done', \"result\" = ? $where", [Js::jsonStringify($result) ?? '{}', $scope, $key, $userId]);

            return $result;
        });
    }
}
