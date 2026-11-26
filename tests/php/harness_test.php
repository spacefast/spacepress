<?php

declare(strict_types=1);

/*
 * The WordPress test harness itself (tests/php/wp.php): a suite that dies of a PHP fatal error or
 * an uncaught exception leaves nothing behind, and still prints the site's log. Each case runs
 * this file again as a child that creates a site, starts its web server and then ends that way;
 * the parent checks the site directory and the server are gone.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

if (($argv[1] ?? '') === 'child') {
    $site = wpSite('harness-child', ['schema' => ['name' => 'harness', 'collections' => []]]);
    $site->startServer();
    file_put_contents($argv[3], json_encode(['dir' => $site->dir, 'url' => $site->url(), 'server' => $site->serverPid()]));
    // A failing suite has printed by the time it dies; `failed` is what makes the harness show the log.
    if ($argv[2] !== 'done') {
        error_log('harness-child wrote this to the site log');
        $GLOBALS['failed'] = 1;
    }
    match ($argv[2]) {
        'fatal' => harness_test_no_such_function(),
        'exception' => throw new RuntimeException('a suite that throws'),
        'done' => exit(0),
    };
}

// SP_WP_KEEP=1 keeps a suite's site on purpose; these children must clean up whatever the caller set.
putenv('SP_WP_KEEP');
foreach (['fatal' => 255, 'exception' => 255, 'done' => 0] as $case => $status) {
    $report = tempnam(sys_get_temp_dir(), 'spacepress-harness-');
    $errors = tempnam(sys_get_temp_dir(), 'spacepress-harness-');
    $child = proc_open([PHP_BINARY, '-d', 'memory_limit=512M', __FILE__, 'child', $case, $report], [1 => ['file', '/dev/null', 'w'], 2 => ['file', $errors, 'w']], $pipes);
    $code = proc_close($child);
    $site = json_decode((string) file_get_contents($report), true);
    $stderr = (string) file_get_contents($errors);
    unlink($report);
    unlink($errors);
    if (!is_array($site)) {
        check("$case: the child started its site", false, ['exit' => $code, 'stderr' => substr($stderr, -2000)]);
        continue;
    }
    eq("$case: the child exits $status", $code, $status);
    clearstatcache();
    $kept = is_dir($site['dir']);
    check("$case: the site directory is removed", !$kept, ['dir' => $site['dir'], 'stderr' => substr($stderr, -2000)]);
    // The server answers `/__sp_site` with its directory for as long as it runs.
    $answer = @file_get_contents($site['url'] . '/__sp_site', false, stream_context_create(['http' => ['timeout' => 2]]));
    $serving = $answer === $site['dir'];
    check("$case: the site's web server is stopped", !$serving, $answer);
    if ($case !== 'done') {
        check("$case: the suite's cleanup still ran and printed the site log", str_contains($stderr, 'harness-child wrote this to the site log'), substr($stderr, -2000));
    }
    // A failure here must not leave behind the very things it reports.
    if ($serving && is_int($site['server'] ?? null)) {
        posix_kill($site['server'], SIGTERM);
    }
    if ($kept) {
        exec('rm -rf ' . escapeshellarg($site['dir']));
    }
}

finish('harness');
