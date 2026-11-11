<?php
declare(strict_types=1);
use First\Identity\{Plugin, Providers, Sessions};
global $wpdb;
$target = 'sfz_' . substr(hash('sha256', 'imported-space'), 0, 24) . '_';
function proof(bool $ok, string $message): void {
    if (!$ok) { throw new RuntimeException($message); }
    echo "ok: $message\n";
}
$phase = $args[0];
if ($phase === 'seed') {
    $uid = wp_insert_user(['user_login'=>'imported-member','user_email'=>'old@example.test','display_name'=>'Imported Member','user_pass'=>'disposable-member-password','role'=>'subscriber']);
    if (is_wp_error($uid)) { throw new RuntimeException($uid->get_error_message()); }
    add_user_meta($uid, '_spacefast_app_user', 'imported-space');
    // Space Users mint one random subject per user and Space; 0.8 handlers saw it as ctx.auth.userId.
    $subject = 'usr_' . str_repeat('ab', 32);
    add_option('spacefast_app_subject_' . $uid . '_imported-space', $subject, '', false);
    add_option('spacefast_app_subject_' . $uid . '_foreign-space', 'usr_' . str_repeat('cd', 32), '', false);
    // A raw legacy hash arrives after identity provisioned its native profile schedule.
    $wpdb->update('wp_users', ['user_pass' => md5('disposable-member-password')], ['ID' => $uid]);
    clean_user_cache($uid);
    require_once ABSPATH . WPINC . '/class-phpass.php';
    $passwordUsers = [];
    $phpass = (new \PasswordHash(8, true))->HashPassword('disposable-member-password');
    $costTen = static fn ($options) => array_replace($options, ['cost' => 10]);
    add_filter('wp_hash_password_options', $costTen);
    try {
        $bcrypt = wp_hash_password('disposable-member-password');
    } finally {
        remove_filter('wp_hash_password_options', $costTen);
    }
    proof(str_starts_with($phpass, '$P$B') && str_starts_with($bcrypt, '$wp$2y$10$'), 'fixtures use default WordPress phpass $P$B and actual wp_hash_password $wp$2y$10$ encodings');
    foreach (['MD5' => md5('disposable-member-password'), 'phpass $P$B' => $phpass, 'WordPress $wp$2y$10$' => $bcrypt] as $encoding => $hash) {
        $login = 'imported-password-' . count($passwordUsers);
        $id = wp_insert_user(['user_login' => $login, 'user_email' => $login . '@example.test', 'user_pass' => 'disposable-member-password', 'role' => 'subscriber']);
        if (is_wp_error($id)) { throw new RuntimeException($id->get_error_message()); }
        add_user_meta($id, '_spacefast_app_user', 'imported-space');
        proof($wpdb->update('wp_users', ['user_pass' => $hash], ['ID' => $id]) !== false, "$encoding source hash stored");
        clean_user_cache($id);
        $profile = strlen($hash) === 32 ? 'md5' : (str_starts_with($hash, '$P$') ? substr($hash, 0, 4) : json_encode([true, 'bcrypt', password_get_info(substr($hash, 3))['options']]));
        $passwordUsers[$encoding] = compact('id', 'login', 'hash', 'profile');
    }
    $login = 'imported-over-ceiling';
    $id = wp_insert_user(['user_login' => $login, 'user_email' => $login . '@example.test', 'user_pass' => 'disposable-member-password', 'role' => 'subscriber']);
    if (is_wp_error($id)) { throw new RuntimeException($id->get_error_message()); }
    add_user_meta($id, '_spacefast_app_user', 'imported-space');
    $hash = password_hash('disposable-member-password', PASSWORD_BCRYPT, ['cost' => 16]);
    proof(str_starts_with($hash, '$2y$16$') && $wpdb->update('wp_users', ['user_pass' => $hash], ['ID' => $id]) !== false, 'canonical over-ceiling bcrypt $2y$16$ source hash stored');
    clean_user_cache($id);
    $profile = json_encode([false, 'bcrypt', ['cost' => 16]]);
    $overCeilingUser = compact('id', 'login', 'hash', 'profile');
    $foreign = wp_insert_user(['user_login'=>'foreign-member','user_email'=>'foreign@example.test','user_pass'=>'disposable-foreign-password','role'=>'subscriber']);
    add_user_meta($foreign, '_spacefast_app_user', 'foreign-space');
    $post = wp_insert_post(['post_title'=>'Imported post','post_content'=>'<p>Preserved body</p>','post_type'=>'post','post_status'=>'publish','post_author'=>$uid]);
    add_post_meta($post, '_spacefast_space_id', 'imported-space');
    $revision = _wp_put_post_revision($post);
    register_taxonomy('zero_collection', ['post']);
    $collection = wp_insert_term('Projects', 'zero_collection')['term_id'];
    add_term_meta($collection, '_zero_resource_id', 'projects');
    $project = wp_insert_post(['post_title'=>'Imported project','post_type'=>'post','post_status'=>'publish','post_author'=>$uid]);
    add_post_meta($project, '_spacefast_space_id', 'imported-space');
    add_post_meta($project, '_zero_projects_budget', '42.5');
    add_post_meta($project, '_zero_projects_active', 'true');
    wp_set_object_terms($project, [$collection], 'zero_collection');
    $projectRevision = _wp_put_post_revision($project);
    add_metadata('post', $projectRevision, '_zero_projects_budget', '12.5');
    add_metadata('post', $projectRevision, '_zero_projects_active', 'false');
    $attachment = wp_insert_post(['post_title'=>'Imported image','post_type'=>'attachment','post_status'=>'inherit','post_parent'=>$post,'post_author'=>$uid,'post_mime_type'=>'image/png']);
    add_post_meta($attachment, '_wp_attached_file', '2026/11/imported.png');
    $other = wp_insert_post(['post_title'=>'Foreign post','post_type'=>'post','post_status'=>'publish','post_author'=>$foreign]);
    add_post_meta($other, '_spacefast_space_id', 'foreign-space');
    $parent = wp_insert_term('Migration parent', 'category')['term_id'];
    $child = wp_insert_term('Migration child', 'category', ['parent'=>$parent])['term_id'];
    wp_set_object_terms($post, [$child], 'category');
    add_term_meta($child, 'fixture', 'retained');
    foreach (['accounts','emails','providers','sessions'] as $name) {
        $wpdb->query("CREATE TABLE wp_sfi_$name LIKE wp_first_identity_$name");
    }
    $now = time(); $email = 101;
    $wpdb->insert('wp_sfi_accounts', ['wp_user_id'=>$uid,'status'=>'active','primary_email_id'=>$email,'created_at'=>$now]);
    $wpdb->insert('wp_sfi_emails', ['id'=>$email,'wp_user_id'=>$uid,'normalized'=>'verified@example.test','verified_at'=>$now,'method'=>'provider']);
    $wpdb->insert('wp_sfi_providers', ['id'=>201,'identity_key'=>hash('sha256', "https://accounts.google.com\0imported-subject"),'issuer'=>'https://accounts.google.com','subject'=>'imported-subject','wp_user_id'=>$uid,'created_at'=>$now]);
    foreach (['a'=>'old-token','b'=>'logout-token','c'=>'revoke-token','f'=>'expired-token'] as $id=>$token) {
        $wpdb->insert('wp_sfi_sessions', ['id'=>str_repeat($id,32),'wp_user_id'=>$uid,'secret_hash'=>hash_hmac('sha256',$token,wp_salt('auth')),'csrf'=>str_repeat($id,64),'created_at'=>$now-10,'expires_at'=>$id==='f'?$now-1:$now+3600,'verified_at'=>$now,'label'=>'Imported fixture']);
    }
    if ($wpdb->last_error !== '') { throw new RuntimeException($wpdb->last_error); }
    // An initialized but empty scoped WordPress, including independently owned identity tables.
    $tables = $wpdb->get_col("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND LEFT(TABLE_NAME,3)='wp_'");
    foreach ($tables as $table) {
        if (str_starts_with($table, 'wp_sfi_') || (str_starts_with($table, 'wp_first_') && !str_starts_with($table, 'wp_first_identity_'))) { continue; }
        $wpdb->query("CREATE TABLE `" . $target . substr($table,3) . "` LIKE `$table`");
    }
    $wpdb->query("INSERT INTO `{$target}options` SELECT * FROM wp_options");
    $wpdb->query($wpdb->prepare("UPDATE `{$target}options` SET option_name=%s WHERE option_name='wp_user_roles'", $target.'user_roles'));
    file_put_contents('/tmp/spacefast-fixture.json', json_encode(compact('uid','subject','foreign','post','revision','project','projectRevision','attachment','other','parent','child','now','passwordUsers','overCeilingUser')+['salt'=>wp_salt('auth')]));
    proof($wpdb->last_error === '', 'legacy rows and empty scoped tables seeded');
    return;
}
$f = json_decode(file_get_contents('/tmp/spacefast-fixture.json'), true);
extract($f, EXTR_SKIP);
proof(wp_salt('auth') === $salt, 'auth salt retained across prefix bind');
if ($phase === 'nested') {
    $plugin = \First\Wp\Runtime::plugin();
    $db = $plugin->connection();
    $db->transaction(function () use ($db, $plugin, $target): void {
        foreach ([false, true] as $dry) {
            try {
                (new \First\Wp\Legacy\Spacefast($db, $plugin->schema))->run('imported-space', 'wp_', $target, $dry);
                throw new RuntimeException('Nested copier accepted');
            } catch (LogicException $e) {
                proof($e->getMessage() === 'Spacefast migration requires its own per-group transactions', 'copier refuses a joined transaction before writes');
            }
        }
        proof($db->inTransaction(), 'copier leaves the owner transaction intact');
    });
    proof(!$db->inTransaction(), 'refusing nested copy does not poison the owner transaction');
} elseif ($phase === 'password-rollback') {
    if (is_callable([\First\Identity\Accounts::class, 'rememberPasswordHash'])) {
        $profiles = get_option('first_identity_password_profiles');
        foreach ($passwordUsers as $encoding => $fixture) {
            proof(!isset($profiles[$fixture['profile']]), "$encoding profile is absent before copy");
        }
        $warmed = false;
        $observe = static function ($sql) use (&$warmed) {
            if (!$warmed && str_starts_with($sql, 'UPDATE ') && str_contains($sql, "'first_identity_password_profiles'")) {
                $warmed = isset(get_option('first_identity_password_profiles')['md5']);
            }
            return $sql;
        };
        add_filter('query', $observe);
        try {
            $plugin = \First\Wp\Runtime::plugin();
            $report = (new \First\Wp\Legacy\Spacefast($plugin->connection(), $plugin->schema))->run('imported-space', 'wp_', $target, true);
        } finally {
            remove_filter('query', $observe);
        }
        proof($report['groups']['users']['status'] === 'dry-run' && $warmed, 'dry run registers imported hashes and warms the uncommitted profile cache');
        proof(get_option('first_identity_password_profiles') === $profiles, 'dry rollback discards uncommitted password profiles from the option cache');
        proof(maybe_unserialize($wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$target}options WHERE option_name=%s", 'first_identity_password_profiles'))) === $profiles, 'dry rollback restores stored password profiles');
        proof((int)$wpdb->get_var("SELECT COUNT(*) FROM {$target}users") === 0, 'dry rollback removes every imported user');
    }
} elseif ($phase === 'storage-failure') {
    // The pending security release makes failed reads distinct from an absent session.
    if (is_callable([\First\Identity\Accounts::class, 'rememberPasswordHash'])) {
        $suppress = $wpdb->suppress_errors(true);
        try {
            foreach (['sessions' => 'secret_hash', 'legacy_sessions' => 'pending'] as $name => $column) {
                $table = $target . 'first_identity_' . $name;
                proof($wpdb->query("ALTER TABLE $table RENAME COLUMN $column TO unavailable") !== false, 'identity lookup column made unreadable');
                try {
                    try {
                        Plugin::$sessions->find('old-token');
                        throw new RuntimeException('Failed read became an absent session');
                    } catch (\First\Identity\Failure $e) {
                        proof($e->kind === 'storage_unavailable' && $e->status === 503 && !str_contains($e->getMessage(), $table), 'canonical and legacy reads propagate sanitized storage failures');
                    }
                    $_COOKIE['__Host-sfi_session'] = 'old-token';
                    $GLOBALS['wp']->query_vars['rest_route'] = '/first/v1/me';
                    $_SERVER['REQUEST_METHOD'] = 'GET';
                    wp_set_current_user(0);
                    $error = apply_filters('rest_authentication_errors', null);
                    proof(is_wp_error($error) && $error->get_error_code() === 'storage_unavailable' && $error->get_error_data()['status'] === 503, 'REST alias returns storage failure instead of anonymous success');
                    proof(!isset($_COOKIE[Sessions::COOKIE]) && get_current_user_id() === 0, 'failed lookup issues no canonical cookie and authenticates nobody');
                } finally {
                    proof($wpdb->query("ALTER TABLE $table RENAME COLUMN unavailable TO $column") !== false, 'identity lookup column restored');
                    unset($_COOKIE['__Host-sfi_session']);
                }
            }
        } finally {
            $wpdb->suppress_errors($suppress);
        }
    }
} elseif ($phase === 'upgrade-failure') {
    $table = $target . 'first_identity_sessions';
    proof($wpdb->query("CREATE TRIGGER first_upgrade_failure BEFORE UPDATE ON $table FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='disposable upgrade failure'") !== false, 'upgrade failure trigger installed');
    $suppress = $wpdb->suppress_errors(true);
    try {
        try {
            Plugin::$sessions->find('old-token');
            throw new RuntimeException('Failed upgrade accepted');
        } catch (\First\Identity\Failure $e) {
            proof($e->kind === 'storage_conflict' && $e->status === 409, 'upgrade write failure propagates');
        }
        $_COOKIE['__Host-sfi_session'] = 'old-token';
        $GLOBALS['wp']->query_vars['rest_route'] = '/first/v1/me';
        $_SERVER['REQUEST_METHOD'] = 'GET';
        wp_set_current_user(0);
        $error = apply_filters('rest_authentication_errors', null);
        proof(is_wp_error($error) && $error->get_error_code() === 'storage_conflict' && $error->get_error_data()['status'] === 409, 'REST alias refuses an upgrade failure instead of authenticating or serving a guest');
    } finally {
        $wpdb->query('DROP TRIGGER first_upgrade_failure');
        $wpdb->suppress_errors($suppress);
        unset($_COOKIE['__Host-sfi_session']);
    }
    $hash = $wpdb->get_var($wpdb->prepare("SELECT secret_hash FROM $table WHERE id=%s", str_repeat('a',32)));
    proof(hash_equals(hash_hmac('sha256','old-token',wp_salt('auth')), $hash) && (int)$wpdb->get_var($wpdb->prepare("SELECT pending FROM {$target}first_identity_legacy_sessions WHERE session_id=%s",str_repeat('a',32)))===1, 'failed upgrade changes neither legacy hash nor pending flag');
} elseif ($phase === 'comments') {
    $wpdb->insert('wp_comments', ['comment_post_ID' => $post, 'comment_content' => 'Unsupported comment']);
} elseif ($phase === 'clear-comments') {
    $wpdb->delete('wp_comments', ['comment_post_ID' => $post]);
} elseif ($phase === 'content-drift') {
    $plugin = \First\Wp\Runtime::plugin();
    $db = $plugin->connection();
    $copier = new \First\Wp\Legacy\Spacefast($db, $plugin->schema);
    $verify = static function () use ($copier, $target): array {
        try {
            return $copier->run('imported-space', 'wp_', $target, false, true)['groups'];
        } catch (\First\Wp\Legacy\SpacefastDrift $drift) {
            return $drift->groups;
        }
    };
    $statuses = static fn (array $groups): array => array_map(static fn ($g) => $g['status'], $groups);
    $all = ['posts' => 'verified', 'users' => 'verified', 'sessions' => 'verified'];
    proof($statuses($verify()) === $all && (int)$wpdb->get_var("SELECT COUNT(*) FROM {$target}first_spacefast_migrations WHERE fingerprint LIKE 'v2:%'") === 3, 'content receipts verify an unchanged source');
    $session = str_repeat('c', 32);
    // Each edit keeps every COUNT/MAX the pre-content receipts hashed, so only row contents reveal it.
    $edits = [
        'posts' => [['wp_postmeta', 'meta_value', ['post_id' => $project, 'meta_key' => '_zero_projects_budget'], '43'], ['wp_posts', 'post_title', ['ID' => $post], 'Edited after copy'], ['wp_termmeta', 'meta_value', ['term_id' => $child, 'meta_key' => 'fixture'], 'edited']],
        'users' => [['wp_users', 'user_email', ['ID' => $uid], 'changed@example.test'], ['wp_users', 'user_pass', ['ID' => $uid], md5('changed-password')], ['wp_usermeta', 'meta_value', ['user_id' => $uid, 'meta_key' => 'nickname'], 'Changed nickname'], ['wp_sfi_emails', 'normalized', ['wp_user_id' => $uid], 'changed@example.test']],
        'sessions' => [['wp_sfi_sessions', 'secret_hash', ['id' => $session], hash_hmac('sha256', 'replaced-token', wp_salt('auth'))], ['wp_sfi_sessions', 'expires_at', ['id' => $session], $now + 7200]],
    ];
    foreach ($edits as $group => $changes) {
        foreach ($changes as [$table, $column, $where, $value]) {
            $before = $wpdb->get_var($wpdb->prepare("SELECT `$column` FROM `$table` WHERE " . implode(' AND ', array_map(static fn ($k) => "`$k`=%s", array_keys($where))), ...array_values($where)));
            proof($before !== null && (string)$before !== (string)$value && $wpdb->update($table, [$column => $value], $where) === 1, "$table.$column edited in the source");
            $observed = $statuses($verify());
            proof($observed === array_replace($all, [$group => 'drifted']), "content receipt reports $group drifted after a $table.$column edit: " . json_encode($observed));
            proof($wpdb->update($table, [$column => $before], $where) === 1, "$table.$column restored");
        }
    }
    proof($statuses($verify()) === $all, 'content receipts verify again once the source is restored');
    // A source subject that no longer matches the copied one is incomplete, checked before drift.
    $option = 'spacefast_app_subject_' . $uid . '_imported-space';
    // The source Space's options table, which the copier reads; not this request's option API.
    $setSubject = static fn (string $value) => $wpdb->update('wp_options', ['option_value' => $value], ['option_name' => $option]);
    proof($setSubject('usr_' . str_repeat('ef', 32)) === 1, 'source subject changed after the copy');
    $seen = $statuses($verify());
    proof($seen === array_replace($all, ['users' => 'incomplete']), 'a changed source subject reports the users group incomplete: ' . json_encode($seen));
    // The subject is also part of the users fingerprint: with the target updated to match, the
    // receipt written for the old subject drifts.
    update_user_meta($uid, 'first_spacefastSubject', 'usr_' . str_repeat('ef', 32));
    proof($statuses($verify()) === array_replace($all, ['users' => 'drifted']), 'a subject change the receipt never saw drifts the users group');
    proof($setSubject($subject) === 1, 'source subject restored');
    update_user_meta($uid, 'first_spacefastSubject', $subject);
    proof($statuses($verify()) === $all, 'the restored subject verifies again');
    // Receipts written before content fingerprints hashed aggregate counters (formula pinned here).
    $scope = (new ReflectionMethod($copier, 'scope'))->invoke($copier, 'imported-space', 'wp_');
    [, $ids, $users] = $scope;
    $legacy = static function (string $group) use ($db, $ids, $users): string {
        $keys = $group === 'posts' ? $ids : $users;
        $where = implode(',', array_fill(0, count($keys), '?'));
        $values = match ($group) {
            'posts' => [
                $db->run("SELECT COUNT(*) AS count, MAX(post_modified_gmt) AS modified FROM `wp_posts` WHERE ID IN ($where)", $keys)[0],
                $db->run("SELECT MAX(meta_id) AS meta FROM `wp_postmeta` WHERE post_id IN ($where)", $keys)[0],
                $db->run("SELECT COUNT(*) AS relationships FROM `wp_term_relationships` WHERE object_id IN ($where)", $keys)[0],
            ],
            'users' => [
                $db->run("SELECT COUNT(*) AS count, MAX(ID) AS id FROM `wp_users` WHERE ID IN ($where)", $keys)[0],
                $db->run("SELECT MAX(umeta_id) AS meta FROM `wp_usermeta` WHERE user_id IN ($where)", $keys)[0],
            ],
            'sessions' => $db->run("SELECT COUNT(*) AS count, MAX(id) AS id, MAX(revoked_at) AS revoked FROM `wp_sfi_sessions` WHERE wp_user_id IN ($where)", $keys),
        };
        return hash('sha256', json_encode($values, JSON_THROW_ON_ERROR));
    };
    foreach (array_keys($all) as $group) {
        $wpdb->update($target . 'first_spacefast_migrations', ['fingerprint' => $legacy($group)], ['space_id' => 'imported-space', 'table_group' => $group]);
    }
    $groups = $verify();
    proof($statuses($groups) === $all && array_filter($groups, static fn ($g) => !preg_match('/\A[0-9a-f]{64}\z/', $g['stored']) || $g['current'] !== $g['stored']) === [], 'receipts written before content fingerprints still verify an unchanged source');
} elseif ($phase === 'drift') {
    $wpdb->update('wp_posts', ['post_modified_gmt' => '2099-01-01 00:00:00'], ['ID' => $post]);
} elseif ($phase === 'dry') {
    proof((int)$wpdb->get_var("SELECT COUNT(*) FROM {$target}posts")===0 && (int)$wpdb->get_var("SELECT COUNT(*) FROM {$target}users")===0, 'dry run leaves data empty');
    proof(!$wpdb->get_var($wpdb->prepare('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s',$target.'first_spacefast_migrations')), 'dry run creates no receipt table');
} elseif ($phase === 'conflict') {
    $wpdb->query($wpdb->prepare("INSERT INTO {$target}posts SELECT * FROM wp_posts WHERE ID=%d", $post));
    $wpdb->update($target.'posts', ['post_title'=>'Conflicting target'], ['ID'=>$post]);
} elseif ($phase === 'rollback') {
    proof((int)$wpdb->get_var("SELECT COUNT(*) FROM {$target}terms")===0, 'post conflict rolls back term writes');
    proof((int)$wpdb->get_var("SELECT COUNT(*) FROM {$target}first_spacefast_migrations")===0, 'failed group has no receipt');
    $wpdb->delete($target.'posts', ['ID'=>$post]);
} elseif ($phase === 'copied') {
    proof((int)$wpdb->get_var("SELECT COUNT(*) FROM {$target}first_spacefast_migrations WHERE fingerprint REGEXP '^v2:[0-9a-f]{64}$'")===3, 'each group receipt stores a versioned source content fingerprint');
    proof((int)$wpdb->get_var("SELECT COUNT(*) FROM {$target}posts")===5, 'only fenced native and collection posts, revisions and attachment copied');
    $p = get_post($post);
    proof($p->post_type==='first_posts' && $p->post_content==='<p>Preserved body</p>' && (int)$p->post_author===$uid, 'post ID, body and author retained with candidate type');
    proof(get_post($revision)->post_type==='revision' && (int)get_post($attachment)->post_parent===$post && get_post_meta($attachment,'_wp_attached_file',true)==='2026/11/imported.png', 'revision and attachment IDs and metadata retained');
    proof(!get_post($other) && !get_userdata($foreign), 'foreign Space posts and users absent');
    proof(get_user_meta($uid, 'first_spacefastSubject', true) === $subject && count(get_user_meta($uid, 'first_spacefastSubject')) === 1, 'Space Users subject copied once to the hidden member column');
    $member = \First\Wp\Runtime::plugin()->db()->findFirst('members', ['where' => ['id' => $uid], 'columns' => ['spacefastSubject' => true]]);
    proof(($member['spacefastSubject'] ?? null) === $subject, 'trusted member reads return the 0.8 subject');
    $mask = rest_do_request(new WP_REST_Request('GET', '/first/v1/members/' . $uid));
    proof(!array_key_exists('spacefastSubject', (array) ($mask->get_data()['data'] ?? [])), 'REST never exposes the migrated subject');
    proof((int)get_term($child)->parent===$parent && get_term_meta($child,'fixture',true)==='retained' && wp_get_object_terms($post,'category',['fields'=>'ids'])===[$child], 'taxonomy hierarchy, metadata and relationships retained');
    proof(get_post($project)->post_type==='first_projects' && get_post_meta($project,'first_budget',true)==='42.5' && get_post_meta($project,'first_active',true)==='1', 'collection tag maps to candidate type and typed metadata');
    proof(get_post_meta($projectRevision,'first_budget',true)==='12.5' && get_post_meta($projectRevision,'first_active',true)==='0', 'collection revision fields use parent mapping');
    if (is_callable([\First\Identity\Accounts::class, 'rememberPasswordHash'])) {
        $profiles = get_option('first_identity_password_profiles');
        foreach ($passwordUsers as $encoding => $fixture) {
            proof(isset($profiles[$fixture['profile']]) && is_string($profiles[$fixture['profile']]) && $profiles[$fixture['profile']] !== $fixture['hash'], "$encoding copier profile registered before any imported sign-in");
        }
        $refuseOverCeiling = static function (string $stage) use ($overCeilingUser, $wpdb, $target): void {
            proof($wpdb->get_var($wpdb->prepare("SELECT user_pass FROM {$target}users WHERE ID=%d", $overCeilingUser['id'])) === $overCeilingUser['hash'], "over-ceiling bcrypt $2y$16$ is copied unchanged $stage");
            try {
                Plugin::$accounts->password($overCeilingUser['login'], 'disposable-member-password');
                throw new RuntimeException('Over-ceiling imported password accepted');
            } catch (\First\Identity\Failure $e) {
                proof($e->kind === 'invalid_credentials' && $e->status === 401, "over-ceiling bcrypt $2y$16$ fails closed $stage");
            }
            proof(!isset(get_option('first_identity_password_profiles')[$overCeilingUser['profile']]), "over-ceiling bcrypt $2y$16$ never enters the profile schedule $stage");
        };
        if (is_callable([\First\Identity\Accounts::class, 'inventoryPasswordHashes'])) {
            proof(get_option('first_identity_password_inventory')['complete'] === false, 'background inventory is incomplete before imported sign-in');
            foreach ($passwordUsers as $encoding => $fixture) {
                proof(Plugin::$accounts->password($fixture['login'], 'disposable-member-password') === $fixture['id'], "$encoding authenticates after migration before inventory completes");
            }
            $refuseOverCeiling('before inventory completes');
            for ($page = 0; $page < 10 && !get_option('first_identity_password_inventory')['complete']; $page++) {
                do_action('first_identity_password_inventory');
            }
            proof(get_option('first_identity_password_inventory')['complete'] === true, 'cron inventory completes before fixed-profile schedule comparison');
        }
        $refuseOverCeiling('after inventory completes');
        $request = new \WP_REST_Request('POST', '/first-identity/v1/sign-in/password');
        $request->set_header('origin', home_url());
        $request->set_body_params(['operation' => 'sign-in/password', 'login' => $overCeilingUser['login'], 'password' => 'disposable-member-password']);
        $response = Plugin::$api->dispatch($request);
        proof($response->get_status() === 401 && $response->get_data()['error']['code'] === 'invalid_credentials', 'Identity password API refuses the copied over-ceiling user');
        proof((int)$wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$target}first_identity_sessions WHERE wp_user_id=%d", $overCeilingUser['id'])) === 0, 'over-ceiling sign-in issues no session');
        proof($wpdb->get_var($wpdb->prepare('SELECT user_pass FROM wp_users WHERE ID=%d', $overCeilingUser['id'])) === $overCeilingUser['hash'], 'over-ceiling refusal leaves the source hash unchanged');
        $schedules = [];
        foreach (['missing-imported-member', 'imported-member'] as $login) {
            $work = [];
            $observe = static function ($valid, $plain, $hash) use (&$work) {
                $info = password_get_info(str_starts_with($hash, '$wp') ? substr($hash, 3) : $hash);
                $work[] = strlen($hash) <= 32 ? 'md5' : json_encode([$info['algoName'], $info['options']]);
                return $valid;
            };
            add_filter('check_password', $observe, 10, 3);
            try {
                Plugin::$accounts->password($login, 'incorrect-password');
                throw new RuntimeException('Incorrect imported password accepted');
            } catch (\First\Identity\Failure $e) {
                proof($e->kind === 'invalid_credentials', 'imported and absent accounts use the generic password refusal');
            } finally {
                remove_filter('check_password', $observe);
            }
            sort($work);
            $schedules[] = $work;
        }
        proof(in_array('md5', $schedules[0], true) && count($schedules[0]) >= 2 && $schedules[0] === $schedules[1], 'completed inventory gives imported and absent users identical verification schedules');
    }
    foreach ($passwordUsers as $encoding => $fixture) {
        proof($wpdb->get_var($wpdb->prepare("SELECT user_pass FROM {$target}users WHERE ID=%d", $fixture['id'])) === $fixture['hash'], "$encoding migration preserves the exact stored encoding");
        proof(Plugin::$accounts->password($fixture['login'], 'disposable-member-password') === $fixture['id'], "$encoding authenticates after migration");
        $authenticated = wp_authenticate($fixture['login'], 'disposable-member-password');
        proof($authenticated instanceof \WP_User && $authenticated->ID === $fixture['id'], "$encoding authenticates through native WordPress sign-in");
        proof($wpdb->get_var($wpdb->prepare('SELECT user_pass FROM wp_users WHERE ID=%d', $fixture['id'])) === $fixture['hash'], "$encoding authentication leaves the source hash unchanged");
    }
    $u = get_userdata($uid);
    proof($u->user_email==='verified@example.test' && wp_check_password('disposable-member-password',$u->user_pass,$uid) && $u->roles===['subscriber'], 'user ID, verified email, password and scoped role retained');
    proof((int)$wpdb->get_var("SELECT COUNT(*) FROM {$target}first_identity_legacy_sessions WHERE pending=1")===4, 'only imported sessions marked for upgrade');
    $config = Providers::config()['google'];
    proof($config['issuer']==='https://accounts.google.com' && $config['client_id']===FIRST_IDENTITY_GOOGLE_CLIENT_ID, 'Google built-in provider receives host configuration');
    proof(Plugin::$accounts->provider($config['issuer'],'imported-subject','verified@example.test','Imported Member')===$uid, 'Google provider subject resolves to original imported user ID');
    // Native rows never receive the compatibility hash lookup, even if the stored digest is HMAC.
    $wpdb->insert($target.'first_identity_sessions', ['id'=>str_repeat('e',32),'wp_user_id'=>$uid,'secret_hash'=>hash_hmac('sha256','native-legacy-shaped',wp_salt('auth')),'csrf'=>str_repeat('e',64),'created_at'=>$now,'expires_at'=>$now+3600,'verified_at'=>$now,'label'=>'Unmarked row']);
    Plugin::$sessions->revoke($uid,str_repeat('c',32));
    proof(Plugin::$sessions->find('revoke-token')===null, 'revocation rejects a never-upgraded imported session');
} elseif ($phase === 'drop-subject') {
    proof(delete_user_meta($uid, 'first_spacefastSubject'), 'copied subject removed after the users receipt');
} elseif ($phase === 'restore-subject') {
    proof(add_user_meta($uid, 'first_spacefastSubject', $subject, true) !== false, 'copied subject restored');
} elseif ($phase === 'snapshot-users') {
    // The operator's backup before the users copy: the target's users and usermeta as they were.
    foreach (['users', 'usermeta'] as $table) {
        proof($wpdb->query("CREATE TABLE {$target}{$table}_backup AS SELECT * FROM {$target}{$table}") !== false, "target $table backed up");
    }
} elseif ($phase === 'recover-subjects') {
    // What the 409 tells an operator to do: restore the target users from that backup, delete the
    // stale users receipt, and rerun. The rerun then copies the users and their subjects.
    foreach (['users', 'usermeta'] as $table) {
        proof($wpdb->query("DELETE FROM {$target}{$table}") !== false && $wpdb->query("INSERT INTO {$target}{$table} SELECT * FROM {$target}{$table}_backup") !== false, "target $table restored from the backup");
    }
    proof($wpdb->delete($target . 'first_spacefast_migrations', ['space_id' => 'imported-space', 'table_group' => 'users']) === 1, 'stale users receipt deleted');
} elseif ($phase === 'authenticated') {
    $s = $wpdb->get_row("SELECT * FROM {$target}first_identity_sessions WHERE id='".str_repeat('a',32)."'", ARRAY_A);
    proof(hash_equals(Sessions::digest('old-token'),$s['secret_hash']) && (int)$s['expires_at']===$now+3600, 'old cookie upgraded to v2 hash without extending expiry');
    proof((int)$wpdb->get_var("SELECT pending FROM {$target}first_identity_legacy_sessions WHERE session_id='".str_repeat('a',32)."'")===0, 'upgrade clears imported flag');
    proof((int)$wpdb->get_var("SELECT revoked_at FROM {$target}first_identity_sessions WHERE id='".str_repeat('b',32)."'")>0 && Plugin::$sessions->find('logout-token')===null, 'logout revokes previously unupgraded session');
    proof(Plugin::$sessions->find('native-legacy-shaped')===null, 'native row never accepts a legacy-shaped digest');
    proof(Plugin::$sessions->find('expired-token')===null, 'expired imported session stays expired');
    proof((int)$wpdb->get_var("SELECT COUNT(*) FROM wp_sfi_sessions WHERE revoked_at IS NULL")===4, 'migration and lazy upgrade leave source rows unchanged');
}
