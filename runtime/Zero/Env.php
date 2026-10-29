<?php

declare(strict_types=1);

namespace Zero;

/** `env("NAME")` at runtime: the process environment, else (WordPress) a wp-config constant of that name. */
final class Env
{
    public static function get(string $name): ?string
    {
        $value = getenv($name);
        if ($value !== false) {
            return $value;
        }
        if (defined($name)) {
            $constant = constant($name);

            return is_scalar($constant) ? (string) $constant : null;
        }

        return null;
    }

    /** A schema.php value that is either a literal string or `['env' => NAME]`. */
    public static function resolve(mixed $value): ?string
    {
        if (is_array($value) && isset($value['env'])) {
            return self::get((string) $value['env']);
        }

        return is_string($value) ? $value : null;
    }
}
