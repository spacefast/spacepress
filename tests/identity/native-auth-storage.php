<?php
// Shared by the existing native-password/MariaDB and auth/SQLite suites.
declare(strict_types=1);

(static function (): void {
    $db = \Zero\Identity\Plugin::$db;
    $accounts = \Zero\Identity\Plugin::$accounts;
    $assert = static function (bool $ok, string $label): void {
        if (!$ok) {
            throw new RuntimeException($label);
        }
    };
    // Exercise an upgrade inventory on real users without password hashing per fixture row.
    $inventory = 'zero_identity_password_inventory';
    $fixtureTag = 'inventory-' . bin2hex(random_bytes(6)) . '-';
    $fixtureHash = get_option('zero_identity_dummy_password_hash');
    for ($batch = 0; $batch < 25; $batch++) {
        $values = [];
        for ($i = 0; $i < 100; $i++) {
            $values[] = $db->wp->prepare('(%s,%s)', $fixtureTag . ($batch * 100 + $i), $fixtureHash);
        }
        $db->run("INSERT INTO {$db->wp->users} (user_login,user_pass) VALUES " . implode(',', $values));
    }
    delete_option($inventory);
    delete_option('zero_identity_password_profiles');
    $inventoryReads = 0;
    $observeInventory = static function ($sql) use (&$inventoryReads, $db) {
        if (preg_match('/^SELECT .*user_pass.*FROM ' . preg_quote($db->wp->users, '/') . '/i', $sql)) {
            $inventoryReads++;
        }
        return $sql;
    };
    add_filter('query', $observeInventory);
    \Zero\Identity\Accounts::provisionPasswordHash();
    remove_filter('query', $observeInventory);
    $assert($inventoryReads === 0, 'ordinary requests never inventory WordPress password hashes');
    $peak = 0;
    $page = static function () use (&$peak): void {
        memory_reset_peak_usage();
        $start = memory_get_usage();
        do_action('zero_identity_password_inventory');
        $peak = max($peak, memory_get_peak_usage() - $start);
    };
    $page();
    $first = get_option($inventory);
    $assert(is_array($first) && $first['after'] > 0 && !$first['complete'], 'first bounded page persists a resumable cursor');
    $crash = static function ($sql) {
        if (strtoupper(trim($sql)) === 'COMMIT') {
            throw new RuntimeException('simulated inventory crash');
        }
        return $sql;
    };
    add_filter('query', $crash);
    try {
        $page();
        throw new RuntimeException('Inventory crash was not injected');
    } catch (RuntimeException $e) {
        $assert($e->getMessage() === 'simulated inventory crash', 'inventory interruption reached the page commit');
    } finally {
        remove_filter('query', $crash);
    }
    $assert(get_option($inventory) === $first, 'interrupted page preserves the last committed cursor');
    $page();
    $assert(get_option($inventory)['after'] > $first['after'], 'next worker resumes beyond the committed page');
    for ($attempt = 0; $attempt < 100 && !get_option($inventory)['complete']; $attempt++) {
        $page();
    }
    $assert(get_option($inventory)['complete'], 'multi-page inventory eventually completes');
    $assert($peak < 2 * 1024 * 1024, 'inventory holds less than 2 MiB of transient memory with 2500 users');
    $db->run("DELETE FROM {$db->wp->users} WHERE user_login LIKE %s", $db->wp->esc_like($fixtureTag) . '%');
    echo "PASS password inventory: 2500 users, resumable crash, peak transient bytes=$peak\n";
    $_SERVER['REMOTE_ADDR'] ??= '127.0.0.1';
    $_SERVER['REQUEST_METHOD'] ??= 'GET';
    $tag = bin2hex(random_bytes(6));
    $password = 'disposable-storage-test-password';
    $uid = wp_create_user('storage-' . $tag, $password);
    $assert(is_int($uid), 'WordPress user created');
    $assert($accounts->status($uid) === 'none', 'successful missing identity read stays distinct');
    $assert(wp_authenticate('storage-' . $tag, $password) instanceof WP_User, 'native user without identity works');
    $_COOKIE[LOGGED_IN_COOKIE] = wp_generate_auth_cookie($uid, time() + 3600, 'logged_in');
    $assert((int) apply_filters('determine_current_user', false) === $uid, 'cookie user without identity works');
    add_filter('wp_is_application_passwords_available', '__return_true');
    add_filter('application_password_is_api_request', '__return_true');
    [$appPassword] = WP_Application_Passwords::create_new_application_password($uid, ['name' => 'storage']);
    $appLogin = static fn () => wp_authenticate_application_password(null, 'storage-' . $tag, $appPassword);
    $assert($appLogin() instanceof WP_User, 'application password without identity works');
    $completeInventory = get_option($inventory);
    update_option($inventory, ['after' => 0, 'complete' => false], false);
    $fallbackChecks = [];
    $observeFallback = static function ($valid, $plain, $hash, $id) use (&$fallbackChecks) {
        $fallbackChecks[] = [$hash, $id];
        return $valid;
    };
    add_filter('check_password', $observeFallback, 10, 4);
    try {
        $assert($accounts->password('storage-' . $tag, $password) === $uid, 'correct login works before inventory completes');
        try {
            $accounts->password('absent-' . $tag, 'incorrect-password');
            throw new RuntimeException('Missing account accepted during inventory');
        } catch (\Zero\Identity\Failure $e) {
            $assert($e->kind === 'invalid_credentials', 'incomplete inventory keeps generic refusal');
        }
    } finally {
        remove_filter('check_password', $observeFallback);
        update_option($inventory, $completeInventory, false);
    }
    $fixedDummy = get_option('zero_identity_dummy_password_hash');
    $assert($fallbackChecks === [[$fixedDummy, 0], [get_userdata($uid)->user_pass, $uid], [$fixedDummy, 0], [$fixedDummy, 0]], 'incomplete inventory always verifies the current dummy plus own hash or dummy');
    $verified = [];
    $observe = static function ($valid, $plain, $hash, $userId) use (&$verified) {
        $verified[] = [$hash, $userId];
        return $valid;
    };
    add_filter('check_password', $observe, 10, 4);
    try {
        foreach (['storage-' . $tag, 'absent-' . $tag, 'absent-' . $tag] as $login) {
            try {
                $accounts->password($login, 'incorrect-password');
                throw new RuntimeException('Wrong password accepted');
            } catch (\Zero\Identity\Failure $e) {
                $assert($e->kind === 'invalid_credentials' && $e->getMessage() === 'The sign-in details are incorrect.', 'generic sign-in refusal');
            }
        }
    } finally {
        remove_filter('check_password', $observe);
    }
    $profileCount = count(get_option('zero_identity_password_profiles'));
    $assert(count($verified) === 3 * $profileCount, 'each attempt verifies every stored password profile');
    [$knownChecks, $absentChecks, $repeatChecks] = array_chunk($verified, $profileCount);
    $actualChecks = array_values(array_filter($knownChecks, static fn ($check) => (int) $check[1] === $uid));
    $assert(count($actualChecks) === 1 && $actualChecks[0][0] === get_userdata($uid)->user_pass, 'known user is verified by ID within its schedule');
    $assert($absentChecks === $repeatChecks && array_unique(array_column($absentChecks, 1)) === [0], 'absent accounts repeat the fixed dummy schedule');
    $currentDummy = get_option('zero_identity_dummy_password_hash');
    $assert(in_array([$currentDummy, 0], $absentChecks, true) && !wp_password_needs_rehash($currentDummy), 'absent schedule includes a fixed current-algorithm hash');
    require_once ABSPATH . WPINC . '/class-phpass.php';
    $legacyPassword = 'legacy profile password';
    $legacyUsers = [];
    $legacyHashes = [
        md5($legacyPassword),
        (new PasswordHash(8, true))->HashPassword($legacyPassword),
        password_hash($legacyPassword, PASSWORD_BCRYPT, ['cost' => 4]),
        crypt($legacyPassword, '$1$saltsalt$'),
        crypt($legacyPassword, '$5$rounds=5000$saltsaltsalt$'),
        crypt($legacyPassword, '$6$rounds=5000$saltsaltsalt$'),
    ];
    if (in_array('argon2id', password_algos(), true)) {
        $validArgon = password_hash($legacyPassword, 'argon2id', ['memory_cost' => 8192, 'time_cost' => 1, 'threads' => 1]);
        $legacyHashes[] = $validArgon;
    }
    foreach ($legacyHashes as $i => $hash) {
        $legacyId = wp_create_user('legacy-' . $i . '-' . $tag, $legacyPassword);
        $old = get_userdata($legacyId);
        $db->wp->update($db->wp->users, ['user_pass' => $hash], ['ID' => $legacyId]);
        clean_user_cache($legacyId);
        do_action('profile_update', $legacyId, $old);
        $legacyUsers[] = $legacyId;
    }
    $unsupportedUsers = [];
    $unsupportedHashes = [
        str_repeat('!', 60),
        '$2y$99$' . str_repeat('a', 53),
        '$wp$2y$12$' . str_repeat('!', 53),
        '$2y$99$' . str_repeat('!', 53),
        '$argon2id$v=19$m=1,t=2,p=1$' . str_repeat('!', 43),
        '$argon2id$v=19$m=8192,t=1,p=1$' . str_repeat('A', 22) . '$' . str_repeat('!', 43),
        '$5$rounds=0005000$saltsaltsalt$' . str_repeat('a', 43),
        '$6$rounds=0005000$saltsaltsalt$' . str_repeat('a', 86),
        '$1$bad!salt$' . str_repeat('a', 22),
    ];
    if (isset($validArgon)) {
        foreach (['m=8192' => 'm=08192', 't=1' => 't=01', 'p=1' => 'p=01'] as $canonical => $malformed) {
            $unsupportedHashes[] = str_replace($canonical, $malformed, $validArgon);
        }
    }
    foreach ($unsupportedHashes as $i => $hash) {
        $invalidId = wp_create_user('disabled-' . $i . '-' . $tag, $legacyPassword);
        $old = get_userdata($invalidId);
        $db->wp->update($db->wp->users, ['user_pass' => $hash], ['ID' => $invalidId]);
        clean_user_cache($invalidId);
        do_action('profile_update', $invalidId, $old);
        $unsupportedUsers[] = $invalidId;
    }
    $schedules = [];
    foreach (array_merge([$uid], $legacyUsers, $unsupportedUsers, [0]) as $candidate) {
        $profileChecks = [];
        $observeProfiles = static function ($valid, $plain, $hash) use (&$profileChecks) {
            $wp = str_starts_with($hash, '$wp');
            $info = password_get_info($wp ? substr($hash, 3) : $hash);
            $profileChecks[] = strlen($hash) <= 32 ? 'md5' : (str_starts_with($hash, '$P$') ? substr($hash, 0, 4) : json_encode([$wp, $info['algoName'], $info['options']]));
            return $valid;
        };
        add_filter('check_password', $observeProfiles, 10, 3);
        try {
            $accounts->password($candidate ? get_userdata($candidate)->user_login : 'absent-profile-' . $tag, 'incorrect-password');
            throw new RuntimeException('Wrong profile password accepted');
        } catch (\Zero\Identity\Failure $e) {
            $assert($e->kind === 'invalid_credentials', 'every password profile has the same generic refusal');
        } finally {
            remove_filter('check_password', $observeProfiles);
        }
        sort($profileChecks);
        $schedules[] = $profileChecks;
    }
    $assert(count($schedules[0]) >= 7 && array_filter($schedules, static fn ($checks) => $checks !== $schedules[0]) === [], 'known, absent, MD5, phpass, cheaper bcrypt, imported crypt and disabled accounts perform the same verification work');
    foreach ($unsupportedUsers as $invalidId) {
        $acceptPluggable = static fn ($valid, $plain, $hash, $id) => $id === $invalidId ? true : $valid;
        add_filter('check_password', $acceptPluggable, 10, 4);
        try {
            $accounts->password(get_userdata($invalidId)->user_login, $legacyPassword);
            throw new RuntimeException('Unsupported password format accepted');
        } catch (\Zero\Identity\Failure $e) {
            $assert($e->kind === 'invalid_credentials', 'unsupported password formats fail closed without custom verification work');
        } finally {
            remove_filter('check_password', $acceptPluggable);
        }
    }
    foreach ($legacyUsers as $legacyId) {
        $assert($accounts->password(get_userdata($legacyId)->user_login, $legacyPassword) === $legacyId, 'legacy WordPress passwords still authenticate');
    }
    wp_set_password('replacement legacy password', $legacyUsers[0]);
    require_once ABSPATH . 'wp-admin/includes/user.php';
    wp_delete_user($legacyUsers[0]);
    foreach (get_option('zero_identity_password_profiles') as $dummy) {
        $assert(!wp_check_password($legacyPassword, $dummy), 'retained verification profiles cannot verify credentials after password replacement and user deletion');
    }
    $accounts->ensure($uid);
    $client = 'storage_' . $tag;
    $db->insert('applications', ['id' => $client, 'name' => 'Storage test', 'redirects' => '[]', 'origins' => '[]']);
    if (!did_action('zero_runtime_loaded')) {
        do_action('zero_runtime_loaded');
    }
    $tokens = $accounts->issueForUser($uid, $client);
    $assert((new \Zero\Identity\OAuth($db, $accounts))->access($tokens['access_token'])['uid'] === $uid, 'OAuth token works before suspension');
    // Retain credentials: suspension status itself must refuse, even without revocation help.
    $db->run("UPDATE {$db->prefix}accounts SET status='suspended' WHERE wp_user_id=%d", $uid);
    $assert(is_wp_error(wp_authenticate('storage-' . $tag, $password)), 'suspended native login refused');
    $assert(is_wp_error($appLogin()), 'suspended application password refused');
    $assert((int) apply_filters('determine_current_user', false) === 0, 'suspended cookie refused');
    $table = $db->prefix . 'accounts';
    $raw = defined('DB_PATH') ? new PDO('sqlite:' . DB_PATH) : null;
    $ddl = static fn (string $sql) => $raw !== null ? $raw->exec($sql) : $db->wp->query($sql);
    $suppress = $db->wp->suppress_errors(true);
    $assert($ddl("ALTER TABLE $table RENAME TO {$table}_unavailable") !== false, "accounts table made unreadable");
    try {
        foreach (['row', 'rows'] as $method) {
            try {
                $db->$method("SELECT * FROM $table");
                throw new RuntimeException('Failed read became an absent row');
            } catch (\Zero\Identity\Failure $e) {
                $assert($e->kind === 'storage_unavailable' && $e->status === 503 && !str_contains($e->getMessage(), $table), 'sanitized storage refusal');
            }
        }
        $native = wp_authenticate('storage-' . $tag, $password);
        $assert(is_wp_error($native) && $native->get_error_code() === 'storage_unavailable', 'native password refuses storage failure');
        $application = $appLogin();
        $assert(is_wp_error($application) && $application->get_error_code() === 'storage_unavailable', 'application password refuses storage failure');
        $assert((int) apply_filters('determine_current_user', false) === 0, 'cookie refuses storage failure');
        $error = apply_filters('rest_authentication_errors', null);
        $assert(is_wp_error($error) && $error->get_error_code() === 'storage_unavailable', 'failed cookie is an error, never anonymous REST');
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $tokens['access_token'];
        $assert((int) \Zero\Identity\Bearer::resolve($uid) === 0, 'Bearer refuses storage failure even with cookie identity');
        $error = \Zero\Identity\Bearer::errors(null);
        $assert(is_wp_error($error) && $error->get_error_code() === 'storage_unavailable', 'failed Bearer is an error, never anonymous REST');
        try {
            (new \Zero\Identity\OAuth($db, $accounts))->access($tokens['access_token']);
            throw new RuntimeException('OAuth accepted storage failure');
        } catch (\Zero\Identity\Failure $e) {
            $assert($e->kind === 'storage_unavailable', 'OAuth refuses storage failure');
        }
        if (class_exists(\Zero\Wp\WpAuth::class)) {
            wp_set_current_user($uid);
            $assert(\Zero\Wp\CoreAccess::viewer() === null, 'core access refuses failed authentication instead of using anonymous policy');
            try {
                \Zero\Wp\WpAuth::current();
                throw new RuntimeException('Runtime accepted storage failure');
            } catch (\Zero\HttpError $e) {
                $assert($e->status === 503 && $e->errorCode === 'storage_unavailable', 'runtime suspension guard refuses storage failure');
            }
        }
    } finally {
        $assert($ddl("ALTER TABLE {$table}_unavailable RENAME TO $table") !== false, "accounts table restored");
        $db->wp->suppress_errors($suppress);
        unset($_SERVER['HTTP_AUTHORIZATION'], $_COOKIE[LOGGED_IN_COOKIE]);
        \Zero\Identity\Bearer::resolve(0);
        apply_filters('determine_current_user', 0);
        wp_set_current_user(0);
        remove_filter('wp_is_application_passwords_available', '__return_true');
        remove_filter('application_password_is_api_request', '__return_true');
    }
    // Core can return false before setting last_error (for example a disconnected handle).
    $disconnected = new class extends wpdb {
        public function __construct() { $this->ready = false; }
    };
    $deadDb = new \Zero\Identity\DB($disconnected);
    foreach (['row', 'rows'] as $method) {
        try {
            $deadDb->$method('SELECT 1');
            throw new RuntimeException('False query with empty last_error became missing data');
        } catch (\Zero\Identity\Failure $e) {
            $assert($e->kind === 'storage_unavailable' && $disconnected->last_error === '', 'false query is unavailable even without last_error');
        }
    }
    $liveAccounts = \Zero\Identity\Plugin::$accounts;
    \Zero\Identity\Plugin::$db = $deadDb;
    \Zero\Identity\Plugin::$accounts = new \Zero\Identity\Accounts($deadDb, \Zero\Identity\Plugin::$security);
    add_filter('wp_is_application_passwords_available', '__return_true');
    try {
        $native = wp_authenticate('storage-' . $tag, $password);
        add_filter('application_password_is_api_request', '__return_true');
        $application = $appLogin();
        $_COOKIE[LOGGED_IN_COOKIE] = wp_generate_auth_cookie($uid, time() + 3600, 'logged_in');
        $cookieUser = apply_filters('determine_current_user', false);
        $error = apply_filters('rest_authentication_errors', null);
        $assert(is_wp_error($native) && $native->get_error_code() === 'storage_unavailable', 'native password refuses false query with empty last_error');
        $assert(is_wp_error($application) && $application->get_error_code() === 'storage_unavailable', 'application password refuses false query with empty last_error');
        $assert((int) $cookieUser === 0 && is_wp_error($error) && $error->get_error_code() === 'storage_unavailable', 'cookie refuses false query with empty last_error');
    } finally {
        \Zero\Identity\Plugin::$db = $db;
        \Zero\Identity\Plugin::$accounts = $liveAccounts;
        unset($_COOKIE[LOGGED_IN_COOKIE]);
        apply_filters('determine_current_user', false);
        remove_filter('wp_is_application_passwords_available', '__return_true');
        remove_filter('application_password_is_api_request', '__return_true');
    }
    echo "PASS identity storage failures refuse cookie, native password, application password, Bearer/OAuth and runtime authentication\n";
})();
