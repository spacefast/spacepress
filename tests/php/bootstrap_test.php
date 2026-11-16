<?php

declare(strict_types=1);

ini_set('precision', '6');
ini_set('serialize_precision', '3');
ini_set('display_errors', '1');
ini_set('log_errors', '0');
$settings = static fn (): array => array_map(ini_get(...), ['precision', 'serialize_precision', 'display_errors', 'log_errors']);
$before = $settings();
require __DIR__ . '/../../runtime/TypedPress/bootstrap.php';
require __DIR__ . '/harness.php';

eq('bootstrap preserves host numeric and diagnostic settings', $settings(), $before);
$number = 1.2345678901234567;
eq('native TypedPress JSON preserves the complete floating point value', \TypedPress\Json::encode(['n' => $number], JSON_THROW_ON_ERROR), '{"n":1.2345678901234567}');
eq('successful encoding restores host settings', $settings(), $before);
eq('the host retains its own JSON precision', json_encode($number), '1.23');
eq('the host retains its own string precision', (string) $number, '1.23457');
eq('JavaScript numeric serialization owns its spelling independently of ini', \TypedPress\Js::jsonStringify(new \TypedPress\JsObject(['n' => $number])), '{"n":1.2345678901234567}');

try { \TypedPress\Json::encode(INF, JSON_THROW_ON_ERROR); } catch (JsonException) {}
eq('JSON exceptions restore host settings', $settings(), $before);
eq('nonthrowing JSON errors preserve the PHP API', \TypedPress\Json::encode(INF), false);
eq('nonthrowing JSON errors restore host settings', $settings(), $before);
try { \TypedPress\Json::encode([], 0, 0); } catch (ValueError) {}
eq('invalid encoding arguments restore host settings', $settings(), $before);

$callback = new class implements JsonSerializable {
    public function jsonSerialize(): mixed
    {
        if (\TypedPress\Json::encode(1.2345678901234567) !== '1.2345678901234567') {
            throw new RuntimeException('nested numeric encoding changed');
        }
        throw new RuntimeException('serializer failed');
    }
};
try { \TypedPress\Json::encode($callback); } catch (RuntimeException) {}
eq('nested serializer exceptions restore host settings', $settings(), $before);
eq('sync canonical numbers retain their own spelling', \TypedPress\Sync\Canon::json(['n' => $number]), '{"n":1.2345678901234567}');
eq('all encoding preserves numeric and diagnostic settings', $settings(), $before);
finish('bootstrap');
