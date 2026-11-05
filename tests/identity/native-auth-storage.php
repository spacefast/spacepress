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
