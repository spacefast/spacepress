<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use SpacePress\Identity\{Plugin, Security, Mfa, Organizations, Privacy, Failure};
function ok( bool $value, string $label ): void {
	check( $value, $label );}
$db    = Plugin::$db;
$uid   = Plugin::$accounts->emailLogin( 'security-' . bin2hex( random_bytes( 5 ) ) . '@example.test' );
$mfa   = new Mfa( $db, Plugin::$security );
$setup = $mfa->setup( $uid, 'Test' );
$otp   = \SpacePress\Identity\Vendor\OTPHP\TOTP::createFromSecret( $setup['secret'] );
$code  = $otp->now();
ok( ! $mfa->verify( $uid, '000000', true ), 'incorrect authenticator enrollment rejected' );
ok( $mfa->verify( $uid, $code, true ), 'real TOTP enrollment' );
ok( ! $mfa->verify( $uid, $code ), 'TOTP timestep replay rejected' );
$codes = $mfa->recoveryCodes( $uid );
ok( $mfa->verify( $uid, $codes[0] ), 'recovery code signs in' );
ok( ! $mfa->verify( $uid, $codes[0] ), 'recovery code one-use' );
$orgs = new Organizations( $db, Plugin::$security, Plugin::$accounts );
$r    = new WP_REST_Request( 'POST' );
$r->set_body_params(
	array(
		'name'            => 'Contract organization',
		'idempotency_key' => Security::token(),
	)
);
$org = $orgs->handle( 'organizations', 'POST', $r, $uid );
ok( $org === $orgs->handle( 'organizations', 'POST', $r, $uid ), 'organization creation is idempotent' );
$r = new WP_REST_Request( 'POST' );
$r->set_body_params(
	array(
		'organization_id' => $org['id'],
		'user_id'         => (string) $uid,
		'role'            => 'member',
	)
);
try {
	$orgs->handle( 'organizations/role', 'POST', $r, $uid );
	throw new RuntimeException( 'Last owner removed' );
} catch ( Failure $e ) {
	ok( 'last_owner' === $e->kind, 'last organization owner protected' );}
$session               = Plugin::$sessions->create( $uid );
$_COOKIE['zi_session'] = $session['secret'];
$deletion              = new WP_REST_Request( 'POST' );
$deletion->set_url_params( array( 'operation' => 'account/delete' ) );
$deletion->set_header( 'Origin', untrailingslashit( home_url() ) );
$deletion->set_header( 'X-Identity-CSRF', $session['session']['csrf'] );
$deletion->set_body_params( array( 'confirmation' => 'DELETE' ) );
$response = Plugin::$api->dispatch( $deletion )->get_data();
ok( ( $response['error']['code'] ?? '' ) === 'last_owner' && 'active' === Plugin::$accounts->profile( $uid )['status'], 'sole owner can still sign in to transfer ownership before deletion' );
$member = Plugin::$accounts->emailLogin( 'member-' . bin2hex( random_bytes( 5 ) ) . '@example.test' );
$email  = Plugin::$accounts->profile( $member )['emails'][0]['email'];
$secret = Security::token();
$id     = Plugin::$security->challenge(
	'invitation',
	$uid,
	'',
	array(
		'organization_id' => $org['id'],
		'email'           => $email,
	),
	$secret,
	600
);
$r      = new WP_REST_Request( 'POST' );
$r->set_body_params( array( 'invitation' => $id . '.' . $secret ) );
try {
	$orgs->handle( 'organizations/accept', 'POST', $r, $uid );
	throw new RuntimeException( 'Wrong account accepted invitation' );
} catch ( Failure $e ) {
	ok( 'invitation_email_required' === $e->kind, 'invitation requires owned verified address' );
}ok( $orgs->handle( 'organizations/accept', 'POST', $r, $member )['joined'], 'verified invited account joins' );
$r = new WP_REST_Request( 'POST' );
$r->set_body_params(
	array(
		'organization_id' => $org['id'],
		'user_id'         => (string) $member,
		'role'            => 'owner',
	)
);
$orgs->handle( 'organizations/role', 'POST', $r, $uid );
$post = wp_insert_post(
	array(
		'post_title'  => 'Retained authorship',
		'post_author' => $uid,
		'post_status' => 'draft',
	)
);
Plugin::$accounts->suspend( $uid, true );
$db->run( "UPDATE {$db->prefix}accounts SET status='deletion_requested' WHERE wp_user_id=%d", $uid );
$privacy = new Privacy( $db, Plugin::$security );
ok( $privacy->erase( $uid )['erased'], 'requested identity erasure completes' );
clean_user_cache( $uid );
$user = get_userdata( $uid );
ok( '' === $user->user_email && 'Deleted account' === $user->display_name && array() === $user->roles && (int) get_post( $post )->post_author === $uid, 'erasure removes identity and preserves anonymized authorship' );
ok( ! $db->row( "SELECT id FROM {$db->prefix}emails WHERE wp_user_id=%d", $uid ), 'erasure releases verified email ownership' );
ok( $privacy->erase( $uid )['erased'], 'erasure retry is idempotent' );
