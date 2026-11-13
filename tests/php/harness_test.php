<?php

declare(strict_types=1);

/*
 * The WordPress test harness itself (tests/php/wp.php): a suite that dies of a PHP fatal error
 * leaves nothing behind. Each case runs this file again as a child that creates a site, starts
 * its web server and then fails; the parent checks the site directory and the server are gone.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

if (($argv[1] ?? '') === 'child') {
    $site = wpSite('harness-child', ['schema' => ['name' => 'harness', 'collections' => []]]);
    $site->startServer();
    file_put_contents($argv[3], json_encode(['dir' => $site->dir, 'url' => $site->url()]));
    match ($argv[2]) {
        'fatal' => harness_test_no_such_function(),
        'exception' => throw new RuntimeException('a suite that throws'),
        'done' => exit(0),
    };
}

foreach (['fatal' => 255, 'exception' => 255, 'done' => 0] as $case => $status) {
    $report = tempnam(sys_get_temp_dir(), 'first-harness-');
    $child = proc_open([PHP_BINARY, '-d', 'memory_limit=512M', __FILE__, 'child', $case, $report], [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes);
    $code = proc_close($child);
    $site = json_decode((string) file_get_contents($report), true);
    unlink($report);
    if (!is_array($site)) {
        check("$case: the child started its site", false, $code);
        continue;
    }
    eq("$case: the child exits $status", $code, $status);
    clearstatcache();
    check("$case: the site directory is removed", !is_dir($site['dir']), $site['dir']);
    // The server answers `/__first_site` with its directory for as long as it runs.
    $answer = @file_get_contents($site['url'] . '/__first_site', false, stream_context_create(['http' => ['timeout' => 2]]));
    check("$case: the site's web server is stopped", $answer !== $site['dir'], $answer);
}

finish('harness');
