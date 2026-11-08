<?php

declare(strict_types=1);

namespace Zero\Wp;

/**
 * The deploy-time schema check (spec §2.9): before a migration file runs, every statement the
 * compiler marked with `-- zero-check {json}` is measured against the live rows.
 *
 * - `drop` (a kind or a field): a table or column that holds rows is dropped only when the deploy
 *   names it with its exact live count, `--drop likes=1204` or `--drop likes.note=12`. A table Zero
 *   didn't create (`existingTable`, e.g. one adopted from Zero 0.8) needs `--drop` even when empty.
 * - `required`: a field that becomes required refuses while rows have no value for it.
 *
 * Every refusal is collected before anything runs, so one deploy reports them all. Additive
 * changes carry no check and apply without one.
 */
final class SchemaCheck
{
    public const MARK = '-- zero-check ';

    /** @param array<string, int> $drops name => the row count the deploy confirmed */
    public function __construct(private readonly Connection $db, private readonly array $drops = [])
    {
    }

    /**
     * `--drop` values: `name=N` (a kind, or `kind.field`), comma-separated or repeated.
     *
     * @param list<string> $values
     * @return array<string, int>
     */
    public static function drops(array $values): array
    {
        $drops = [];
        foreach ($values as $value) {
            foreach (explode(',', $value) as $item) {
                $item = trim($item);
                if ($item === '') {
                    continue;
                }
                if (!preg_match('/^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)=(0|[1-9][0-9]*)$/', $item, $m)) {
                    throw new \Zero\HttpError(422, 'invalid_drop', "--drop takes name=rows, e.g. --drop likes=1204 or --drop likes.note=12; got \"$item\"", '/drop');
                }
                $drops[$m[1]] = (int) $m[2];
            }
        }

        return $drops;
    }

    /** The statement without its check line: what the database runs. */
    public static function sql(string $statement): string
    {
        return str_starts_with($statement, self::MARK) ? (explode("\n", $statement, 2)[1] ?? '') : $statement;
    }

    /**
     * Refuses the pending statements when live rows don't allow them.
     *
     * @param array<string, list<string>> $pending migration id => its statements not yet applied
     * @throws SchemaRefused
     */
    public function check(array $pending): void
    {
        $refusals = [];
        foreach ($pending as $id => $statements) {
            foreach ($statements as $statement) {
                if (!str_starts_with($statement, self::MARK)) {
                    continue;
                }
                $check = json_decode(substr(explode("\n", $statement, 2)[0], strlen(self::MARK)), true, flags: JSON_THROW_ON_ERROR);
                $refusal = match ($check['check']) {
                    'drop' => $this->drop($check),
                    'required' => $this->required($check, (string) $id),
                    default => throw new \RuntimeException('unknown schema check ' . $check['check']),
                };
                if ($refusal !== null) {
                    $refusals[] = ['migration' => (string) $id] + $refusal;
                }
            }
        }
        if ($refusals !== []) {
            throw new SchemaRefused($refusals);
        }
    }

    private function drop(array $check): ?array
    {
        $name = (string) $check['name'];
        $column = $check['column'] ?? null;
        $rows = $this->rows($check, $column === null ? null : 'IS NOT NULL');
        $adopted = ($check['adopted'] ?? false) === true;
        $confirmed = $this->drops[$name] ?? null;
        $what = $column === null ? "the kind $name" : "the field $name";
        $holds = $column === null ? "$rows rows" : "$rows rows with a value";
        if ($confirmed === $rows || ($rows === 0 && !$adopted)) {
            return null;
        }
        $refusal = ['name' => $name, 'table' => $check['table'], 'rows' => $rows, 'drop' => "$name=$rows"];
        if ($column !== null) {
            $refusal['column'] = $column;
        }
        if ($confirmed !== null) {
            return $refusal + [
                'code' => 'drop_count_mismatch',
                'message' => "--drop $name=$confirmed doesn't match the live data: $what holds $holds now.",
                'fix' => "Check what changed, then deploy with --drop $name=$rows to delete them, or keep $name in the schema.",
            ];
        }
        if ($adopted) {
            return $refusal + [
                'code' => 'drop_adopted_table',
                'message' => "Dropping $what would " . ($column === null ? 'drop' : 'alter') . " {$check['table']}, a table Zero didn't create ($holds).",
                'fix' => "Keep $name in the schema, or deploy with --drop $name=$rows to delete it.",
            ];
        }

        return $refusal + [
            'code' => 'drop_has_rows',
            'message' => "Dropping $what would delete $holds.",
            'fix' => "Keep $name in the schema, rename it with .was() if it moved, or deploy with --drop $name=$rows to delete them.",
        ];
    }

    private function required(array $check, string $migration): ?array
    {
        $column = $check['column'] ?? null;
        // A new column has no values yet: every row lacks it.
        $rows = $this->rows($check, $column === null ? null : 'IS NULL');
        if ($rows === 0) {
            return null;
        }
        $name = (string) $check['name'];
        $field = substr($name, strrpos($name, '.') + 1);

        $fill = $column === null ? '' : 'Fill those rows and deploy again, or ';
        $fix = $fill . ($fill === '' ? 'G' : 'g') . "ive $field a default with .default(value), which existing rows get, or keep it optional: "
            . "delete the unapplied zero/_generated/migrations/$migration.sql, restore snapshot.json to the last deployed build, and build again.";

        return ['code' => 'required_field_missing', 'name' => $name, 'table' => $check['table'], 'rows' => $rows,
            'message' => "$name is required, and $rows rows have no value for it.", 'fix' => $fix];
    }

    /** Rows of the check's table, optionally where its column `IS [NOT] NULL`; 0 for a table or column that doesn't exist yet. */
    private function rows(array $check, ?string $where): int
    {
        $table = str_replace('{prefix}', $this->db->prefix(), (string) $check['table']);
        $column = $check['column'] ?? null;
        $exists = $column === null
            ? $this->db->run('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$table]) !== []
            : $this->db->run('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [$table, $column]) !== [];
        if (!$exists) {
            return 0;
        }
        $sql = 'SELECT COUNT(*) AS n FROM `' . str_replace('`', '``', $table) . '`';
        if ($column !== null && $where !== null) {
            $sql .= ' WHERE `' . str_replace('`', '``', (string) $column) . '` ' . $where;
        }

        return (int) $this->db->run($sql)[0]['n'];
    }
}
