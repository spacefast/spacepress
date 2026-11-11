<?php

declare(strict_types=1);

// Build js-references-pipeline.config.ts in a disposable directory, then pass its wp-content path.
require getcwd() . '/tests/php/wp.php';
$wp = wpSite('refs-pipeline', ['wpContent' => $argv[1] ?? throw new InvalidArgumentException('Pass the built wp-content directory')]);
$db = \First\db();
$owner = $db->insert('owners', ['name' => 'Owner'], true)[0];
$meta = '{"count":7,"tags":["a","b","c"],"detail":{"label":"hello"}}';
$rows = [];
for ($i = 0; $i < 200; $i++) {
    $rows[] = ['name' => 'Row ' . $i, 'ownerId' => $owner['id'], 'meta' => \First\Js::decodeJson($meta)];
}
$db->insert('records', $rows);
$requests = 0;
$run = static function () use ($wp, $owner, $meta, &$requests): int {
    [$status, , $body] = $wp->app()->handle('POST', '/actions/report', [], '{}');
    $data = json_decode($body, true, 512, JSON_THROW_ON_ERROR)['data'] ?? null;
    if ($status !== 200 || !is_array($data) || count($data) !== 200) {
        throw new RuntimeException($body);
    }
    foreach ($data as $i => $row) {
        if (!is_int($row['id']) || $row['name'] !== 'Row ' . $i || $row['owner'] !== $owner || $row['meta'] !== json_decode($meta, true)) {
            throw new RuntimeException('Incorrect report row: ' . json_encode($row));
        }
    }
    $requests++;
    return strlen($body);
};
$bytes = $run();
$cpu = static function (): float {
    $usage = getrusage();
    return ($usage['ru_utime.tv_sec'] + $usage['ru_stime.tv_sec']) * 1000 + ($usage['ru_utime.tv_usec'] + $usage['ru_stime.tv_usec']) / 1000;
};
$samples = [];
$cpuSamples = [];
for ($round = 0; $round < 5; $round++) {
    $start = hrtime(true);
    $cpuStart = $cpu();
    for ($i = 0; $i < 20; $i++) { $run(); }
    $samples[] = (hrtime(true) - $start) / 20 / 1e6;
    $cpuSamples[] = ($cpu() - $cpuStart) / 20;
}
echo json_encode(['rows' => 200, 'warmups' => 1, 'requestsPerRound' => 20, 'requests' => $requests, 'errors' => 0, 'msPerRequest' => $samples, 'cpuMsPerRequest' => $cpuSamples, 'responseBytes' => $bytes, 'php' => PHP_VERSION, 'opcacheCli' => ini_get('opcache.enable_cli')], JSON_THROW_ON_ERROR) . "\n";
