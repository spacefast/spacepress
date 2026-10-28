<?php

declare(strict_types=1);

namespace Zero;

/** SQL dialect value object (§3.2). See the CHANGED note in Store.php for `ciCollation` and `likeFn`. */
final class Dialect
{
    public function __construct(
        public readonly string $name,            // 'sqlite' | 'mysql'
        public readonly string $quoteOpen,       // '"' | '`'
        public readonly string $quoteClose,
        /** sprintf template: (expr, ci arg). SQLite: 1/0; MySQL: a collation name. */
        public readonly string $likeFn,
        public readonly bool $windowFunctions,   // both true (SQLite >= 3.25, MariaDB >= 10.2)
        /** MySQL only: the case-insensitive collation for ilike ('utf8mb4_0900_ai_ci' MySQL 8, 'utf8mb4_unicode_ci' MariaDB). */
        public readonly string $ciCollation = 'utf8mb4_0900_ai_ci',
    ) {
    }

    public static function sqlite(): self
    {
        return new self('sqlite', '"', '"', 'zero_like(%s, ?, %s)', true, '');
    }

    public static function mysql(string $ciCollation = 'utf8mb4_0900_ai_ci'): self
    {
        return new self('mysql', '`', '`', "%s LIKE ? COLLATE %s ESCAPE '\\\\'", true, $ciCollation);
    }

    public function quote(string $ident): string
    {
        return $this->quoteOpen . str_replace($this->quoteClose, $this->quoteClose . $this->quoteClose, $ident) . $this->quoteClose;
    }
}
