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
    /** @var array<string, string> the propagation (its group key) each handed row's values came from */
    public array $from = [];
    /** @var list<callable(): void> run after every row is written, inside the update's transaction */
    public array $after = [];
    /** The row being written right now, by Db::rowKey(). */
    public ?string $current = null;

    /**
     * @param list<string> $keys
     * @param int $depth nesting among open bulk updates, 0 outermost
     */
    public function __construct(public readonly string $collection, array $keys, public readonly int $depth)
    {
        $this->pending = array_fill_keys($keys, true);
    }

    /** Hand $values to pending row $pk on behalf of the propagation $group (a group-sync key). */
    public function hand(int|string $pk, array $values, string $group): void
    {
        $key = Db::rowKey($pk);
        $this->handed[$key] = $values + ($this->handed[$key] ?? []);
        $this->from[$key] = $group;
    }
}
