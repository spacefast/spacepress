<?php

declare(strict_types=1);

namespace Zero\Wp;

use Zero\HttpError;
use Zero\JsArray;
use Zero\JsObject;

/**
 * WordPress functions called from TypeScript (`import { get_option } from "php/wordpress"`). The
 * compiler only emits calls to the catalog's allowlist (src/wordpress/catalog.json) with the
 * arguments the author may pass and the fixed ones the catalog adds; this converts values at the
 * boundary: JS values in as PHP arrays, results out as JS values or typed WP_Post/WP_User views.
 */
final class Functions
{
    /** @param list<mixed> $args the author's arguments, then the catalog's fixed ones */
    public static function call(string $function, array $args): mixed
    {
        $result = $function(...array_map(self::toPhp(...), $args));
        if ($result instanceof \WP_Error) {
            // The error's own status when it carries one; otherwise WordPress refused the input.
            $data = $result->get_error_data();
            $status = is_array($data) && is_int($data['status'] ?? null) ? $data['status'] : 422;
            throw new HttpError($status, (string) $result->get_error_code(), $result->get_error_message());
        }
        $plugin = Runtime::plugin();

        return Hooks::toJs($result, $plugin?->schema->wpViews() ?? []);
    }

    private static function toPhp(mixed $value): mixed
    {
        return match (true) {
            $value instanceof JsObject, $value instanceof JsArray => \Zero\Seam::toPhp($value),
            $value === \Zero\JsUndefined::Value => null,
            default => $value,
        };
    }
}
