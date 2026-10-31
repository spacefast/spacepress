<?php

declare(strict_types=1);

namespace Zero;

/**
 * One open `Db::update` over several rows. Rows it has yet to write are pending: an extension that
 * would write one of them itself (translation group sync) hands it values instead, and defers checks
 * that need every row written to the end of the update. Each row is then written, and its hooks run,
 * exactly once.
 */
final class BulkUpdate
{
    /** @var array<string, true> rows not written yet, by Db::rowKey() */
    public array $pending;
    /** @var array<string, array> values handed to a pending row, merged over the patch when it is written */
    public array $handed = [];
    /** @var list<callable(): void> run after every row is written, inside the update's transaction */
    public array $after = [];

    /** @param list<string> $keys */
    public function __construct(public readonly string $collection, array $keys)
    {
        $this->pending = array_fill_keys($keys, true);
    }

    public function hand(int|string $pk, array $values): void
    {
        $this->handed[Db::rowKey($pk)] = $values + ($this->handed[Db::rowKey($pk)] ?? []);
    }
}
