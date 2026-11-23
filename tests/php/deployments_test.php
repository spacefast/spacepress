<?php

declare(strict_types=1);

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$plugin = dirname(__DIR__, 2) . '/runtime/spacepress-plugin/spacepress.php';
$mu = "<?php\nrequire " . var_export($plugin, true) . ";\n";
$schema = require dirname(__DIR__) . '/runtime-schema/base.schema.php';
$wp = wpSite('deployments', ['schema' => $schema, 'identity' => true, 'server' => true, 'muPlugins' => ['deployment-permissions' => $mu]]);
check('a plain request skips deployment and setup implementations', array_filter([
    SpacePressPlugin\Setup::class, SpacePressPlugin\Receiver::class, SpacePressPlugin\Deployments::class,
    SpacePressPlugin\Trees::class, SpacePressPlugin\Requirements::class,
], static fn (string $class): bool => class_exists($class, false)) === []);
$admin = $wp->userId('admin');
[$scoped, $item] = WP_Application_Passwords::create_new_application_password($admin, ['name' => 'scoped deployment reader']);
SpacePress\Wp\AgentScope::store($admin, $item['uuid'], ['write' => false, 'personal' => false, 'abilities' => null]);
[$unscoped] = WP_Application_Passwords::create_new_application_password($admin, ['name' => 'deployment reader']);
update_option('sp_deployments', [['build' => str_repeat('0', 64), 'user' => $admin, 'name' => 'example', 'at' => '2026-11-15T00:00:00Z', 'kind' => 'deploy']]);
$request = static function (string $password) use ($wp): array {
    $curl = curl_init($wp->url() . '/wp-json/wp-abilities/v1/abilities/sp/deployments/run');
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
// On a network another site may still run the pre-release plugin and scope a password under the earlier
// key after this site has moved: the receiver refuses it as it refuses one scoped under the current key.
update_option('sp_brand_upgrade', 1);
[$earlier, $earlierItem] = WP_Application_Passwords::create_new_application_password($admin, ['name' => 'scoped elsewhere']);
$passwords = get_user_meta($admin, WP_Application_Passwords::USERMETA_KEY_APPLICATION_PASSWORDS, true);
foreach ($passwords as &$entry) {
    if ($entry['uuid'] === $earlierItem['uuid']) {
        $entry['tp_scope'] = ['write' => false, 'personal' => false, 'abilities' => null];
    }
}
unset($entry);
update_user_meta($admin, WP_Application_Passwords::USERMETA_KEY_APPLICATION_PASSWORDS, $passwords);
$curl = curl_init($wp->url() . '/wp-json/spacepress-deploy/v1/site');
curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_USERPWD => 'admin:' . $earlier]);
$body = json_decode((string) curl_exec($curl), true);
eq('a password scoped under the earlier key cannot deploy on a settled site', [curl_getinfo($curl, CURLINFO_RESPONSE_CODE), $body['code'] ?? null], [403, 'sp_forbidden']);

// An uploaded/previously-ready commerce build must not reach this unqualified host's installer
// or become live through rollback. Use real build-store files and the public selection path.
$root = \SpacePressPlugin\Site::store();
$app = str_repeat('a', 64); $runtime = str_repeat('b', 64);
wp_mkdir_p("$root/app/$app/plugins/spacepress-app-example");
wp_mkdir_p("$root/runtime/$runtime"); wp_mkdir_p("$root/build"); wp_mkdir_p("$root/ready");
file_put_contents("$root/runtime/$runtime/spacepress-loader.php", '<?php');
$manifest = ['format' => 'spacepress.build.v1', 'name' => 'example', 'runtime' => $runtime, 'app' => $app];
$bytes = json_encode($manifest); $build = hash('sha256', $bytes);
file_put_contents("$root/build/$build.json", $bytes);
file_put_contents("$root/ready/$build.json", '{}');
$hosted = ['format' => 'spacepress.hosted.v1', 'requires' => ['woocommerce' => '>=11.3.0']];
file_put_contents("$root/app/$app/manifest.json", json_encode($hosted));
$live = \SpacePressPlugin\Site::live(); $history = \SpacePressPlugin\Site::history();
$refused = false;
try { \SpacePressPlugin\Site::checkCommerce($manifest); } catch (RuntimeException $e) { $refused = str_contains($e->getMessage(), 'does not yet support commerce'); }
check('an uploaded commerce build is refused before initialization', $refused);
$refused = false;
try { \SpacePressPlugin\Receiver::rollback($build); } catch (RuntimeException $e) { $refused = str_contains($e->getMessage(), 'does not yet support commerce'); }
check('even an already-ready commerce rollback is refused', $refused);
eq('a refused commerce rollback preserves the live build and history', [\SpacePressPlugin\Site::live(), \SpacePressPlugin\Site::history()], [$live, $history]);
file_put_contents("$root/app/$app/manifest.json", json_encode(['format' => 'spacepress.hosted.v1', 'requires' => []]));
\SpacePressPlugin\Site::checkCommerce($manifest);
\SpacePressPlugin\Receiver::rollback($build);
eq('ordinary ready builds can still be selected', \SpacePressPlugin\Site::live(), $build);

// The running app's name, checked against a pushed build's: a pre-release build named a renamed app
// for the earlier brand, a current build names an app as it is, whatever its name.
$create = static function (array $running, string $name): string {
    $root = \SpacePressPlugin\Site::store();
    $bytes = json_encode($running);
    file_put_contents("$root/build/" . hash('sha256', $bytes) . '.json', $bytes);
    update_option(\SpacePressPlugin\Site::LIVE, hash('sha256', $bytes));
    update_option(\SpacePressPlugin\Site::HISTORY, [['build' => hash('sha256', $bytes), 'kind' => 'deploy']]);
    $request = new WP_REST_Request('POST');
    $request->set_header('content-type', 'application/json');
    $request->set_body(json_encode(['manifest' => json_encode(['format' => 'spacepress.build.v1', 'name' => $name, 'runtime' => str_repeat('b', 64), 'app' => str_repeat('a', 64), 'baseline' => hash('sha256', $bytes)])]));
    // A deployed site runs no separately installed runtime (Site::conflict()); this one does.
    $deployed = static fn (array $active): array => array_values(array_filter($active, static fn (string $f): bool => !str_starts_with($f, 'spacepress-')));
    add_filter('option_active_plugins', $deployed);
    try {
        \SpacePressPlugin\Receiver::create($request);

        return 'taken';
    } catch (\SpacePressPlugin\Refusal $refusal) {
        return $refusal->problem;
    } finally {
        remove_filter('option_active_plugins', $deployed);
    }
};
eq('a current app named for the earlier brand takes its own next build', $create(['format' => 'spacepress.build.v1', 'name' => 'typedpress-client', 'runtime' => $runtime, 'app' => $app], 'typedpress-client'), 'taken');
eq('… and no other app\'s', $create(['format' => 'spacepress.build.v1', 'name' => 'typedpress-client', 'runtime' => $runtime, 'app' => $app], 'spacepress-client'), 'sp_other_app');
eq('a pre-release build\'s renamed app takes the build under its current name', $create(['format' => 'typedpress.build.v1', 'name' => 'typedpress-client', 'runtime' => $runtime, 'app' => $app], 'spacepress-client'), 'taken');
finish('deployments');
