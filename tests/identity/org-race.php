<?php
// Two owners demote each other at once (two connections). The second demotion read the members
// table (its snapshot) before the first committed, as credentialMutation's transaction does; after
// the organization lock it must see the committed demotion and refuse, leaving one owner.
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use TypedPress\Identity\{Plugin, Security, Organizations};

ob_start();
$db = Plugin::$db;
$tag = bin2hex(random_bytes(4));
$a = Plugin::$accounts->emailLogin("own-a-$tag@example.test");
$b = Plugin::$accounts->emailLogin("own-b-$tag@example.test");
$orgs = new Organizations($db, Plugin::$security, Plugin::$accounts);
$r = new WP_REST_Request('POST');
$r->set_body_params(['name' => "Race $tag", 'idempotency_key' => Security::token()]);
$org = $orgs->handle('organizations', 'POST', $r, $a)['id'];
$db->insert('members', ['organization_id' => $org, 'wp_user_id' => $b, 'role' => 'owner']);

// A holds the organization; B starts its demotion of A and waits on that lock.
$db->run('START TRANSACTION');
$db->row("SELECT id FROM {$db->prefix}organizations WHERE id=%s FOR UPDATE", $org);
$worker = worker('org-worker.php', ['org' => $org, 'actor' => $b, 'target' => $a]);
$thread = (int) trim(fgets($worker[1][1]));
$deadline = microtime(true) + 10;
while (!str_contains((string) ($db->row("SELECT INFO FROM information_schema.PROCESSLIST WHERE ID=%d AND COMMAND='Query'", $thread)['INFO'] ?? ''), $db->prefix . 'organizations')) {
    if (microtime(true) > $deadline) {
        throw new RuntimeException('FAIL the second demotion never waited on the organization lock');
    }
}
// Meanwhile A demotes B and commits.
$r = new WP_REST_Request('POST');
$r->set_body_params(['organization_id' => $org, 'user_id' => (string) $b, 'role' => 'member']);
check($orgs->handle('organizations/role', 'POST', $r, $a) === ['updated' => true], 'the first owner demotes the second');
$db->run('COMMIT');
[$output] = finish_worker($worker);
check($output === 'owner_required', "the stale demotion is refused once it holds the lock ($output)");
check(count($db->rows("SELECT wp_user_id FROM {$db->prefix}members WHERE organization_id=%s AND role='owner'", $org)) === 1, 'exactly one owner remains');

// An invitation accepted while its inviter is being demoted: the committed demotion revokes it.
$c = Plugin::$accounts->emailLogin("own-c-$tag@example.test");
$invitee = Plugin::$accounts->emailLogin("invitee-$tag@example.test");
$r = new WP_REST_Request('POST');
$r->set_body_params(['organization_id' => $org, 'user_id' => (string) $b, 'role' => 'admin']);
$orgs->handle('organizations/role', 'POST', $r, $a); // b is an admin who may invite
$secret = Security::token();
$invitation = Plugin::$security->challenge('invitation', $b, '', ['organization_id' => $org, 'email' => "invitee-$tag@example.test"], $secret, 600);
$db->run('START TRANSACTION');
$db->row("SELECT id FROM {$db->prefix}organizations WHERE id=%s FOR UPDATE", $org);
$worker = worker('accept-worker.php', ['invitation' => "$invitation.$secret", 'uid' => $invitee]);
$thread = (int) trim(fgets($worker[1][1]));
$deadline = microtime(true) + 10;
while (!str_contains((string) ($db->row("SELECT INFO FROM information_schema.PROCESSLIST WHERE ID=%d AND COMMAND='Query'", $thread)['INFO'] ?? ''), $db->prefix . 'organizations')) {
    if (microtime(true) > $deadline) {
        throw new RuntimeException('FAIL the acceptance never waited on the organization lock');
    }
}
$r = new WP_REST_Request('POST');
$r->set_body_params(['organization_id' => $org, 'user_id' => (string) $b, 'role' => 'member']);
$orgs->handle('organizations/role', 'POST', $r, $a); // the inviter is demoted meanwhile
$db->run('COMMIT');
[$output] = finish_worker($worker);
check($output === 'invitation_revoked', "an invitation from a just-demoted inviter is refused ($output)");
check(!$db->row("SELECT wp_user_id FROM {$db->prefix}members WHERE organization_id=%s AND wp_user_id=%d", $org, $invitee), 'and adds no member');
