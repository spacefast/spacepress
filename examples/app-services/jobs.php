<?php

declare(strict_types=1);

// The disposable example disables WP-Cron. This invokes its existing Action Scheduler runner.
$site = $argv[1] ?? '';
if (!preg_match('#^/tmp/first-wp-services-example-[a-f0-9]{8}$#D', $site) || !is_file($site . '/site.json')) {
    fwrite(STDERR, "Pass the owned site path printed by run.php\n");
    exit(2);
}
require dirname(__DIR__, 2) . '/tests/php/wp.php';
wpLoad($site);
\First\Wp\Runtime::plugin()->app();
remove_all_filters('pre_wp_mail');
ActionScheduler_QueueRunner::instance()->run('First app services example');
echo "Due jobs processed by Action Scheduler.\n";
