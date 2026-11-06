<?php
declare(strict_types=1);
use Zero\Identity\{Plugin, Providers, SessionLookup};
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
        $wpdb->query("CREATE TABLE wp_sfi_$name LIKE wp_zero_identity_$name");
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
        if (str_starts_with($table, 'wp_sfi_') || (str_starts_with($table, 'wp_zero_') && !str_starts_with($table, 'wp_zero_identity_'))) { continue; }
        $wpdb->query("CREATE TABLE `" . $target . substr($table,3) . "` LIKE `$table`");
    }
    $wpdb->query("INSERT INTO `{$target}options` SELECT * FROM wp_options");
    $wpdb->query($wpdb->prepare("UPDATE `{$target}options` SET option_name=%s WHERE option_name='wp_user_roles'", $target.'user_roles'));
    file_put_contents('/tmp/spacefast-fixture.json', json_encode(compact('uid','foreign','post','revision','project','projectRevision','attachment','other','parent','child','now')+['salt'=>wp_salt('auth')]));
    proof($wpdb->last_error === '', 'legacy rows and empty scoped tables seeded');
    return;
}
$f = json_decode(file_get_contents('/tmp/spacefast-fixture.json'), true);
extract($f, EXTR_SKIP);
proof(wp_salt('auth') === $salt, 'auth salt retained across prefix bind');
if ($phase === 'dry') {
    proof((int)$wpdb->get_var("SELECT COUNT(*) FROM {$target}posts")===0 && (int)$wpdb->get_var("SELECT COUNT(*) FROM {$target}users")===0, 'dry run leaves data empty');
    proof(!$wpdb->get_var($wpdb->prepare('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s',$target.'zero_spacefast_migrations')), 'dry run creates no receipt table');
} elseif ($phase === 'conflict') {
    $wpdb->query($wpdb->prepare("INSERT INTO {$target}posts SELECT * FROM wp_posts WHERE ID=%d", $post));
    $wpdb->update($target.'posts', ['post_title'=>'Conflicting target'], ['ID'=>$post]);
} elseif ($phase === 'rollback') {
    proof((int)$wpdb->get_var("SELECT COUNT(*) FROM {$target}terms")===0, 'post conflict rolls back term writes');
    proof((int)$wpdb->get_var("SELECT COUNT(*) FROM {$target}zero_spacefast_migrations")===0, 'failed group has no receipt');
    $wpdb->delete($target.'posts', ['ID'=>$post]);
} elseif ($phase === 'copied') {
    proof((int)$wpdb->get_var("SELECT COUNT(*) FROM {$target}posts")===5, 'only fenced native and collection posts, revisions and attachment copied');
    $p = get_post($post);
    proof($p->post_type==='zero_posts' && $p->post_content==='<p>Preserved body</p>' && (int)$p->post_author===$uid, 'post ID, body and author retained with candidate type');
    proof(get_post($revision)->post_type==='revision' && (int)get_post($attachment)->post_parent===$post && get_post_meta($attachment,'_wp_attached_file',true)==='2026/11/imported.png', 'revision and attachment IDs and metadata retained');
    proof(!get_post($other) && !get_userdata($foreign), 'foreign Space posts and users absent');
    proof((int)get_term($child)->parent===$parent && get_term_meta($child,'fixture',true)==='retained' && wp_get_object_terms($post,'category',['fields'=>'ids'])===[$child], 'taxonomy hierarchy, metadata and relationships retained');
    proof(get_post($project)->post_type==='zero_projects' && get_post_meta($project,'zero_budget',true)==='42.5' && get_post_meta($project,'zero_active',true)==='1', 'collection tag maps to candidate type and typed metadata');
    proof(get_post_meta($projectRevision,'zero_budget',true)==='12.5' && get_post_meta($projectRevision,'zero_active',true)==='0', 'collection revision fields use parent mapping');
    $u = get_userdata($uid);
    proof($u->user_email==='verified@example.test' && wp_check_password('disposable-member-password',$u->user_pass,$uid) && $u->roles===['subscriber'], 'user ID, verified email, password and scoped role retained');
    proof((int)$wpdb->get_var("SELECT COUNT(*) FROM {$target}zero_identity_legacy_sessions WHERE pending=1")===4, 'only imported sessions marked for upgrade');
    $config = Providers::config()['google'];
    proof($config['issuer']==='https://accounts.google.com' && $config['client_id']===ZERO_IDENTITY_GOOGLE_CLIENT_ID, 'Google built-in provider receives host configuration');
    proof(Plugin::$accounts->provider($config['issuer'],'imported-subject','verified@example.test','Imported Member')===$uid, 'Google provider subject resolves to original imported user ID');
    // Native rows never receive the compatibility hash lookup, even if the stored digest is HMAC.
    $wpdb->insert($target.'zero_identity_sessions', ['id'=>str_repeat('e',32),'wp_user_id'=>$uid,'secret_hash'=>hash_hmac('sha256','native-legacy-shaped',wp_salt('auth')),'csrf'=>str_repeat('e',64),'created_at'=>$now,'expires_at'=>$now+3600,'verified_at'=>$now,'label'=>'Unmarked row']);
    Plugin::$sessions->revoke($uid,str_repeat('c',32));
    proof(Plugin::$sessions->find('revoke-token')===null, 'revocation rejects a never-upgraded imported session');
} elseif ($phase === 'authenticated') {
    $s = $wpdb->get_row("SELECT * FROM {$target}zero_identity_sessions WHERE id='".str_repeat('a',32)."'", ARRAY_A);
    proof(hash_equals(SessionLookup::digest('old-token'),$s['secret_hash']) && (int)$s['expires_at']===$now+3600, 'old cookie upgraded to v2 hash without extending expiry');
    proof((int)$wpdb->get_var("SELECT pending FROM {$target}zero_identity_legacy_sessions WHERE session_id='".str_repeat('a',32)."'")===0, 'upgrade clears imported flag');
    proof((int)$wpdb->get_var("SELECT revoked_at FROM {$target}zero_identity_sessions WHERE id='".str_repeat('b',32)."'")>0 && Plugin::$sessions->find('logout-token')===null, 'logout revokes previously unupgraded session');
    proof(Plugin::$sessions->find('native-legacy-shaped')===null, 'native row never accepts a legacy-shaped digest');
    proof(Plugin::$sessions->find('expired-token')===null, 'expired imported session stays expired');
    proof((int)$wpdb->get_var("SELECT COUNT(*) FROM wp_sfi_sessions WHERE revoked_at IS NULL")===4, 'migration and lazy upgrade leave source rows unchanged');
}
