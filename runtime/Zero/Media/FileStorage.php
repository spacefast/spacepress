<?php

declare(strict_types=1);

namespace Zero\Media;

/**
 * Where private-file rows and bytes live (phase 2 §7.2): `__zero_files` + `<appRoot>/private` on
 * standalone (Media\SqliteFiles), `{prefix}zero__files` + `uploads/zero-private/<app>` on WordPress
 * (Wp\WpFiles). Files owns every rule; storages only persist. Row values are ints/strings as stored.
 */
interface FileStorage
{
    public function secret(): string;

    /** Null when uploads are safe; otherwise why not (answered as 503 files_unavailable). */
    public function unavailable(): ?string;

    /** Move $tmpPath to the private path $rel (removed again if the transaction rolls back). */
    public function store(string $tmpPath, string $rel): void;

    /** @param array{bucket: string, filename: string, mime: string, size: int, path: string, ownerId: ?int, createdAt: string} $row */
    public function insert(array $row): int;

    /**
     * @param list<int> $ids
     * @return array<int, array{id: int, bucket: string, filename: string, mime: string, size: int, path: string, ownerId: ?int, createdAt: string}>
     */
    public function getMany(array $ids): array;

    /** Delete the row now and its bytes once the transaction commits. */
    public function delete(array $row): void;

    public function absolute(string $rel): string;

    /** Absolute or root-relative URL of an API route ('/files/decks/1/download'). */
    public function apiUrl(string $route): string;

    /** `GET /_schema` `runtime.privateFiles`. */
    public function describe(): array;
}
