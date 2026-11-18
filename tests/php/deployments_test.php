<?php

declare(strict_types=1);

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$plugin = dirname(__DIR__, 2) . '/runtime/typedpress-plugin/typedpress.php';
$mu = "<?php\nrequire " . var_export($plugin, true) . ";\n";
$schema = require dirname(__DIR__) . '/runtime-schema/base.schema.php';
$wp = wpSite('deployments', ['schema' => $schema, 'identity' => true, 'server' => true, 'muPlugins' => ['deployment-permissions' => $mu]]);
check('a plain request skips deployment and setup implementations', array_filter([
    TypedPressPlugin\Setup::class, TypedPressPlugin\Receiver::class, TypedPressPlugin\Deployments::class,
    TypedPressPlugin\Trees::class, TypedPressPlugin\Requirements::class,
], static fn (string $class): bool => class_exists($class, false)) === []);
$admin = $wp->userId('admin');
[$scoped, $item] = WP_Application_Passwords::create_new_application_password($admin, ['name' => 'scoped deployment reader']);
TypedPress\Wp\AgentScope::store($admin, $item['uuid'], ['write' => false, 'personal' => false, 'abilities' => null]);
[$unscoped] = WP_Application_Passwords::create_new_application_password($admin, ['name' => 'deployment reader']);
update_option('tp_deployments', [['build' => str_repeat('0', 64), 'user' => $admin, 'name' => 'example', 'at' => '2026-11-15T00:00:00Z', 'kind' => 'deploy']]);
$request = static function (string $password) use ($wp): array {
    $curl = curl_init($wp->url() . '/wp-json/wp-abilities/v1/abilities/tp/deployments/run');
    curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_USERPWD => 'admin:' . $password]);
    $body = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);

    return [$status, json_decode((string) $body, true)];
};
[$status, $body] = $request($scoped);
eq('a scoped administrator credential cannot list deployment history', $status, 403);
check('the refusal does not disclose the deploying account', !str_contains(json_encode($body), '"by":"admin"'));
[$status, $body] = $request($unscoped);
eq('an unscoped administrator may list deployment history', $status, 200);
eq('the permitted list includes its deploying account', $body['deployments'][0]['by'] ?? null, 'admin');
finish('deployments');
