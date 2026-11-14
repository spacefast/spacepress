<?php

declare(strict_types=1);

namespace First\Content;

use First\JsArray;
use First\JsObject;
use First\OpenApi;
use First\Wp\Plugin;

/**
 * `apiReference(source?)` from "first/content": an OpenAPI 3.1 document as the data an API
 * reference page renders, flat enough for TSX to map over.
 *
 * The type system has no recursive types, so a page can't walk a JSON Schema itself. This reads
 * the document once per request and returns tags, each with its operations, each with its
 * parameters, request body and responses as lists of fields. A field's `depth` says how far it
 * is nested (a property of an object inside an array is depth 1), so a page indents it.
 *
 * The document is the app's own (`first build` writes it from the schema, and the site serves it
 * at `/__first/api/v1/openapi.json`), or a JSON file in the app's `public/` folder when a page
 * names one: `apiReference("partner-api.json")`. Descriptions are Markdown in OpenAPI; they come
 * back as HTML, for `<Html value>`.
 */
final class ApiReference
{
    /** How deep fields are listed below a parameter, body or response. */
    private const DEPTH = 4;
    private const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

    /** @var array<string, JsObject> per source, per request */
    private static array $read = [];

    public static function build(?string $source = null): JsObject
    {
        $key = $source ?? '';
        if (isset(self::$read[$key])) {
            return self::$read[$key];
        }
        $document = $source === null ? self::own() : self::file($source);

        return self::$read[$key] = self::js(self::reference($document ?? []));
    }

    /** The app's own document, with this site as its server. */
    private static function own(): ?array
    {
        $document = OpenApi::document();

        return $document === null ? null : json_decode((string) json_encode($document), true);
    }

    /** A JSON document in the app's `public/` folder, by its path there. */
    private static function file(string $source): ?array
    {
        $plugin = Plugin::instance();
        $relative = ltrim(str_replace('\\', '/', $source), '/');
        if ($plugin === null || $relative === '' || str_contains('/' . $relative . '/', '/../')) {
            return null;
        }
        $file = $plugin->dir . '/public/' . $relative;
        if (!is_file($file)) {
            return null;
        }
        $document = json_decode((string) file_get_contents($file), true);

        return is_array($document) ? $document : null;
    }

    /** @param array<string, mixed> $doc */
    private static function reference(array $doc): array
    {
        $info = is_array($doc['info'] ?? null) ? $doc['info'] : [];
        $server = is_string($doc['servers'][0]['url'] ?? null) ? rtrim($doc['servers'][0]['url'], '/') : '';
        $tags = [];
        foreach (is_array($doc['tags'] ?? null) ? $doc['tags'] : [] as $tag) {
            if (is_string($tag['name'] ?? null)) {
                $tags[$tag['name']] = ['name' => $tag['name'], 'slug' => self::slug($tag['name']), 'description' => self::markdown($tag['description'] ?? null), 'operations' => []];
            }
        }
        foreach (is_array($doc['paths'] ?? null) ? $doc['paths'] : [] as $path => $item) {
            if (!is_array($item)) {
                continue;
            }
            $shared = is_array($item['parameters'] ?? null) ? $item['parameters'] : [];
            foreach (self::METHODS as $method) {
                $op = $item[$method] ?? null;
                if (!is_array($op)) {
                    continue;
                }
                $tag = is_string($op['tags'][0] ?? null) ? $op['tags'][0] : 'Other';
                $tags[$tag] ??= ['name' => $tag, 'slug' => self::slug($tag), 'description' => '', 'operations' => []];
                $tags[$tag]['operations'][] = self::operation($doc, (string) $path, $method, $op, $shared, $server);
            }
        }

        return [
            'title' => is_string($info['title'] ?? null) ? $info['title'] : 'API reference',
            'version' => is_string($info['version'] ?? null) ? $info['version'] : '',
            'description' => self::markdown($info['description'] ?? null),
            'server' => $server,
            'tags' => array_values(array_filter($tags, static fn (array $t): bool => $t['operations'] !== [])),
        ];
    }

    /**
     * @param array<string, mixed> $doc
     * @param array<string, mixed> $op
     * @param list<mixed> $shared
     */
    private static function operation(array $doc, string $path, string $method, array $op, array $shared, string $server): array
    {
        $id = is_string($op['operationId'] ?? null) ? $op['operationId'] : $method . ' ' . $path;
        $params = [];
        foreach (array_merge($shared, is_array($op['parameters'] ?? null) ? $op['parameters'] : []) as $param) {
            $param = self::deref($doc, $param);
            if (!is_string($param['name'] ?? null)) {
                continue;
            }
            $schema = $param['schema'] ?? (is_array($param['content'] ?? null) ? (reset($param['content'])['schema'] ?? null) : null);
            $field = self::field($doc, $param['name'], is_array($schema) ? $schema : [], (bool) ($param['required'] ?? false), 0, $param['description'] ?? null);
            $field['in'] = is_string($param['in'] ?? null) ? $param['in'] : '';
            $params[] = $field;
        }
        $body = [];
        $bodyType = '';
        $example = null;
        $request = self::deref($doc, $op['requestBody'] ?? null);
        if (is_array($request['content'] ?? null) && $request['content'] !== []) {
            $bodyType = (string) array_key_first($request['content']);
            $schema = is_array($request['content'][$bodyType]['schema'] ?? null) ? $request['content'][$bodyType]['schema'] : [];
            $body = self::fields($doc, $schema, 0, []);
            $example = $bodyType === 'application/json' ? self::example($doc, $schema, 0) : null;
        }
        $responses = [];
        foreach (is_array($op['responses'] ?? null) ? $op['responses'] : [] as $status => $response) {
            $response = self::deref($doc, $response);
            $content = is_array($response['content'] ?? null) ? $response['content'] : [];
            $type = $content === [] ? '' : (string) array_key_first($content);
            $schema = $type === '' || !is_array($content[$type]['schema'] ?? null) ? [] : $content[$type]['schema'];
            $responses[] = [
                'status' => (string) $status,
                'description' => self::markdown($response['description'] ?? null),
                'type' => $type,
                'fields' => $type === '' ? [] : self::fields($doc, $schema, 0, []),
            ];
        }
        $url = $server . preg_replace('/\{([^}]+)\}/', '{$1}', $path);

        return [
            'id' => $id,
            'slug' => self::slug(str_replace('.', '-', $id)),
            'method' => strtoupper($method),
            'path' => $path,
            'summary' => is_string($op['summary'] ?? null) ? $op['summary'] : $id,
            'description' => self::markdown($op['description'] ?? null),
            'access' => is_string($op['x-first-access'] ?? null) ? $op['x-first-access'] : '',
            'params' => $params,
            'bodyType' => $bodyType,
            'body' => $body,
            'responses' => $responses,
            'curl' => self::curl(strtoupper($method), $url, $bodyType, $example),
            'fetch' => self::fetch(strtoupper($method), $url, $bodyType, $example),
        ];
    }

    /**
     * The properties of an object schema (or of the objects an array holds), as fields, each
     * followed by its own properties one level deeper.
     *
     * @param array<string, mixed> $doc
     * @param array<string, mixed> $schema
     * @param array<string, true> $seen component names already open above, so a cycle stops
     * @return list<array>
     */
    private static function fields(array $doc, array $schema, int $depth, array $seen): array
    {
        if ($depth >= self::DEPTH) {
            return [];
        }
        [$object, $seen] = self::objectOf($doc, $schema, $seen);
        if ($object === null) {
            return [];
        }
        $required = is_array($object['required'] ?? null) ? $object['required'] : [];
        $out = [];
        foreach ($object['properties'] as $name => $property) {
            $property = is_array($property) ? $property : [];
            $out[] = self::field($doc, (string) $name, $property, in_array($name, $required, true), $depth, $property['description'] ?? null);
            array_push($out, ...self::fields($doc, $property, $depth + 1, $seen));
        }

        return $out;
    }

    /**
     * The object schema whose properties to list: the schema itself, the item schema of an array,
     * or the one object variant of a nullable `anyOf`. Null when there is none, or when it is a
     * component already open above (a cycle).
     *
     * @return array{?array, array<string, true>}
     */
    private static function objectOf(array $doc, array $schema, array $seen): array
    {
        for ($i = 0; $i < 8; $i++) {
            if (is_string($schema['$ref'] ?? null)) {
                if (isset($seen[$schema['$ref']])) {
                    return [null, $seen];
                }
                $seen[$schema['$ref']] = true;
                $schema = self::deref($doc, $schema);
                continue;
            }
            if (is_array($schema['properties'] ?? null) && $schema['properties'] !== []) {
                return [$schema, $seen];
            }
            if (is_array($schema['items'] ?? null)) {
                $schema = $schema['items'];
                continue;
            }
            $variants = array_values(array_filter(
                array_merge(is_array($schema['anyOf'] ?? null) ? $schema['anyOf'] : [], is_array($schema['oneOf'] ?? null) ? $schema['oneOf'] : []),
                static fn (mixed $v): bool => is_array($v) && ($v['type'] ?? null) !== 'null',
            ));
            if (count($variants) !== 1) {
                return [null, $seen];
            }
            $schema = $variants[0];
        }

        return [null, $seen];
    }

    /** @param array<string, mixed> $schema */
    private static function field(array $doc, string $name, array $schema, bool $required, int $depth, mixed $description): array
    {
        $constraints = [];
        foreach (['minimum' => 'min', 'maximum' => 'max', 'minLength' => 'min length', 'maxLength' => 'max length', 'minItems' => 'min items', 'maxItems' => 'max items', 'pattern' => 'matches', 'format' => 'format'] as $key => $label) {
            if (is_scalar($schema[$key] ?? null)) {
                $constraints[] = $label . ' ' . $schema[$key];
            }
        }
        if (($schema['uniqueItems'] ?? false) === true) {
            $constraints[] = 'unique items';
        }
        if (array_key_exists('default', $schema)) {
            $constraints[] = 'default: ' . json_encode($schema['default'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        }
        $enum = $schema['enum'] ?? ($schema['items']['enum'] ?? null);
        if (is_array($enum) && $enum !== []) {
            $constraints[] = 'one of: ' . implode(', ', array_map(static fn (mixed $v): string => is_string($v) ? $v : (string) json_encode($v), $enum));
        }

        return [
            'name' => $name,
            'depth' => $depth,
            'type' => self::type($doc, $schema),
            'required' => $required,
            'description' => self::markdown(is_string($description) ? $description : ($schema['description'] ?? null)),
            'constraints' => $constraints,
            'in' => '',
        ];
    }

    /** A schema's type as a reader says it: `string | null`, `Post[]`, `integer | Author`. */
    private static function type(array $doc, array $schema, int $level = 0): string
    {
        if ($level > 4) {
            return 'object';
        }
        if (is_string($schema['$ref'] ?? null)) {
            return (string) preg_replace('#^.*/#', '', $schema['$ref']);
        }
        foreach (['anyOf', 'oneOf'] as $key) {
            if (is_array($schema[$key] ?? null) && $schema[$key] !== []) {
                $parts = array_map(static fn (mixed $v): string => self::type($doc, is_array($v) ? $v : [], $level + 1), $schema[$key]);
                return implode(' | ', array_values(array_unique(explode(' | ', implode(' | ', $parts)))));
            }
        }
        $types = (array) ($schema['type'] ?? (is_array($schema['properties'] ?? null) ? 'object' : ''));
        $out = [];
        foreach ($types as $type) {
            $out[] = $type === 'array' ? self::type($doc, is_array($schema['items'] ?? null) ? $schema['items'] : [], $level + 1) . '[]' : (string) $type;
        }
        $out = array_values(array_filter($out, static fn (string $t): bool => $t !== '' && $t !== '[]'));

        return $out === [] ? 'any' : implode(' | ', $out);
    }

    /** A JSON body a reader can start from: each required property (or every one, when none is required) with a placeholder of its type. */
    private static function example(array $doc, array $schema, int $level): mixed
    {
        if ($level > 3) {
            return null;
        }
        $schema = self::deref($doc, $schema);
        if (array_key_exists('default', $schema)) {
            return $schema['default'];
        }
        if (is_array($schema['enum'] ?? null) && $schema['enum'] !== []) {
            return $schema['enum'][0];
        }
        foreach (['anyOf', 'oneOf'] as $key) {
            if (is_array($schema[$key] ?? null)) {
                foreach ($schema[$key] as $variant) {
                    if (is_array($variant) && ($variant['type'] ?? null) !== 'null') {
                        return self::example($doc, $variant, $level + 1);
                    }
                }
            }
        }
        $type = ((array) ($schema['type'] ?? (isset($schema['properties']) ? 'object' : 'string')))[0] ?? 'string';
        if ($type === 'object') {
            $properties = is_array($schema['properties'] ?? null) ? $schema['properties'] : [];
            $required = is_array($schema['required'] ?? null) ? $schema['required'] : [];
            $names = $required !== [] ? $required : array_keys($properties);
            $out = new \stdClass();
            foreach ($names as $name) {
                if (isset($properties[$name]) && is_array($properties[$name]) && ($properties[$name]['readOnly'] ?? false) !== true) {
                    $out->{$name} = self::example($doc, $properties[$name], $level + 1);
                }
            }
            return $out;
        }

        return match ($type) {
            'array' => [],
            'integer', 'number' => 0,
            'boolean' => false,
            'null' => null,
            default => 'string',
        };
    }

    private static function curl(string $method, string $url, string $type, mixed $example): string
    {
        $lines = ["curl -X $method '$url'", "  -H 'Accept: application/json'"];
        if ($type === 'application/json') {
            $lines[] = "  -H 'Content-Type: application/json'";
            $lines[] = "  -d '" . str_replace("'", "'\\''", (string) json_encode($example ?? new \stdClass(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) . "'";
        } elseif ($type === 'multipart/form-data') {
            $lines[] = "  -F 'file=@./file'";
        }

        return implode(" \\\n", $lines);
    }

    private static function fetch(string $method, string $url, string $type, mixed $example): string
    {
        $headers = ['"Accept": "application/json"'];
        $body = '';
        if ($type === 'application/json') {
            $headers[] = '"Content-Type": "application/json"';
            $body = "\n  body: JSON.stringify(" . json_encode($example ?? new \stdClass(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . '),';
        } elseif ($type === 'multipart/form-data') {
            $body = "\n  body: form, // a FormData with the file under \"file\"";
        }

        return "const response = await fetch(" . json_encode($url, JSON_UNESCAPED_SLASHES) . ", {\n  method: \"$method\",\n  headers: { " . implode(', ', $headers) . " },$body\n});\nconst data = await response.json();";
    }

    /** A `$ref` to `#/components/...`, followed; anything else as it is. */
    private static function deref(array $doc, mixed $value): array
    {
        for ($i = 0; $i < 8 && is_array($value) && is_string($value['$ref'] ?? null); $i++) {
            $target = $doc;
            foreach (explode('/', ltrim(substr($value['$ref'], 1), '/')) as $part) {
                $part = str_replace(['~1', '~0'], ['/', '~'], $part);
                $target = is_array($target) && array_key_exists($part, $target) ? $target[$part] : null;
            }
            $value = $target;
        }

        return is_array($value) ? $value : [];
    }

    /** `WordPress` → `word-press`, `actions-approveComment` → `actions-approve-comment`. */
    public static function slug(string $name): string
    {
        $kebab = (string) preg_replace('/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/', '-', $name);

        return trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower($kebab)), '-') ?: 'api';
    }

    /** OpenAPI's Markdown, as HTML. */
    private static function markdown(mixed $text): string
    {
        if (!is_string($text) || trim($text) === '') {
            return '';
        }
        static $cache = [];

        return $cache[$text] ??= trim(do_blocks(\First\Sync\Markdown::toBlocks($text)));
    }

    /** PHP arrays to the values compiled code reads: a list is an array, a map an object. */
    private static function js(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        if (array_is_list($value)) {
            return new JsArray(array_map(self::js(...), $value));
        }

        return new JsObject(array_map(self::js(...), $value));
    }
}
