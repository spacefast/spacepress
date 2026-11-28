<?php

declare(strict_types=1);

namespace SpacePress\Identity;

final class Organizations {

	public function __construct(
		private DB $db,
		private Security $security,
		private Accounts $accounts,
	) {}
	private function field(
		\WP_REST_Request $r,
		string $key,
		int $length = 254,
	): string {
		$v = $r->get_param( $key );
		if ( ! is_string( $v ) || '' === $v || strlen( $v ) > $length ) {
			throw new Failure( 'invalid_request', 'Invalid ' . $key . '.' );
		}
		return $v;
	}
	/** A membership read; `$current` makes it a locking read that sees committed changes (InnoDB). */
	private function member( string $org, int $uid, bool $current = false ): array {
		$m = $this->db->row(
			"SELECT role FROM {$this->db->prefix}members WHERE organization_id=%s AND wp_user_id=%d" . ( $current ? ' FOR UPDATE' : '' ),
			$org,
			$uid,
		);
		if ( ! $m ) {
			throw new Failure(
				'forbidden',
				'Organization membership required.',
				403,
			);
		}
		return $m;
	}
	public function handle(
		string $op,
		string $method,
		\WP_REST_Request $r,
		int $uid,
	): mixed {
		if ( 'organizations' === $op && 'GET' === $method ) {
			return $this->db->rows(
				"SELECT o.id,o.name,m.role FROM {$this->db->prefix}organizations o JOIN {$this->db->prefix}members m ON m.organization_id=o.id WHERE m.wp_user_id=%d",
				$uid,
			);
		}
		if ( 'organizations' === $op && 'POST' === $method ) {
			$name = sanitize_text_field( $this->field( $r, 'name', 120 ) );
			$key  = $this->field( $r, 'idempotency_key', 64 );
			$id   = substr(
				Security::hash( 'organization:' . $uid . ':' . $key ),
				0,
				32,
			);
			return $this->db->transaction(
				function () use ( $uid, $name, $id ) {
					$this->db->lock( $uid );
					$row = $this->db->row(
						"SELECT * FROM {$this->db->prefix}organizations WHERE id=%s",
						$id,
					);
					if ( $row ) {
						if ( $row['name'] !== $name ) {
							throw new Failure(
								'idempotency_conflict',
								'This request key was already used.',
								409,
							);
						}
						return array(
							'id'   => $id,
							'name' => $name,
							'role' => 'owner',
						);
					}
					$this->db->insert(
						'organizations',
						array(
							'id'         => $id,
							'name'       => $name,
							'created_at' => time(),
						)
					);
					$this->db->insert(
						'members',
						array(
							'organization_id' => $id,
							'wp_user_id'      => $uid,
							'role'            => 'owner',
						)
					);
					$this->security->event(
						$uid,
						'organization.created',
						array(
							'organization_id' => $id,
						)
					);
					return array(
						'id'   => $id,
						'name' => $name,
						'role' => 'owner',
					);
				}
			);
		}
		if ( 'organizations/accept' === $op && 'POST' === $method ) {
			[$id, $secret] = array_pad(
				explode( '.', $this->field( $r, 'invitation' ), 2 ),
				2,
				'',
			);
			$challenge     = $this->db->row(
				"SELECT payload FROM {$this->db->prefix}challenges WHERE id=%s AND purpose='invitation'",
				$id,
			);
			$payload       = $challenge
				? json_decode( $challenge['payload'], true )
				: null;
			if (
				! $payload ||
				$this->accounts->owner( $payload['email'] ) !== $uid
			) {
				throw new Failure(
					'invitation_email_required',
					'Verify the invited email on this account before joining.',
					403,
				);
			}
			$c = $this->security->consume( $id, 'invitation', $secret );
			return $this->db->transaction(
				function () use ( $uid, $c ) {
					$p   = $c['payload'];
					$org = $this->db->row(
						"SELECT * FROM {$this->db->prefix}organizations WHERE id=%s FOR UPDATE",
						$p['organization_id'],
					);
					if ( ! $org ) {
						throw new Failure(
							'not_found',
							'Organization unavailable.',
							404,
						);
					}
					// A locking read after the organization lock: a demotion that committed meanwhile counts.
					$inviter = $this->member(
						$p['organization_id'],
						(int) $c['wp_user_id'],
						true,
					);
					if ( ! in_array( $inviter['role'], array( 'owner', 'admin' ), true ) ) {
						throw new Failure(
							'invitation_revoked',
							'The inviter can no longer manage this organization.',
							403,
						);
					}
					$this->db->run(
						"INSERT IGNORE INTO {$this->db->prefix}members (organization_id,wp_user_id,role) VALUES (%s,%d,'member')",
						$p['organization_id'],
						$uid,
					);
					$this->security->event(
						$uid,
						'organization.joined',
						array(
							'organization_id' => $p['organization_id'],
						)
					);
					return array( 'joined' => true );
				}
			);
		}
		$org    = $this->field( $r, 'organization_id', 32 );
		$member = $this->member( $org, $uid );
		if ( 'organizations/members' === $op && 'GET' === $method ) {
			return $this->db->rows(
				"SELECT m.wp_user_id,m.role,u.display_name FROM {$this->db->prefix}members m JOIN {$this->db->wp->users} u ON u.ID=m.wp_user_id WHERE organization_id=%s",
				$org,
			);
		}
		if ( ! in_array( $member['role'], array( 'owner', 'admin' ), true ) ) {
			throw new Failure(
				'forbidden',
				'An organization administrator is required.',
				403,
			);
		}
		if ( 'organizations/invite' === $op && 'POST' === $method ) {
			$this->security->limit( 'invite:' . $uid, 10 );
			$email           = Accounts::email( $this->field( $r, 'email' ) );
			$secret          = Security::token( 16 );
			$id              = $this->security->challenge(
				'invitation',
				$uid,
				'',
				array(
					'organization_id' => $org,
					'email'           => $email,
				),
				$secret,
				604800,
			);
			$site_name       = get_bloginfo( 'name' );
			$identity_url    = home_url( Plugin::basePath() );
			$invitation_code = $id . '.' . $secret;
			$subject         = 'Join your organization on ' . $site_name;
			$custom          = class_exists( \SpacePress\Render\Email::class )
				? \SpacePress\Render\Email::invitation( $site_name, $identity_url, $invitation_code )
				: null;
			$sent            = null === $custom
				? wp_mail(
					$email,
					$subject,
					'Sign in at ' . $identity_url .
						" and verify this email. In Organizations, enter this invitation code:\n\n" .
						$invitation_code . "\n\nExpires in seven days.",
				)
				: \SpacePress\Mail::sendWordPress(
					$email,
					$subject,
					$custom['html'],
					array( 'Content-Type: text/html; charset=UTF-8' ),
					$custom['text'],
				);
			if ( ! $sent ) {
				throw new Failure(
					'email_delivery_failed',
					'Invitation could not be sent.',
					503,
				);
			}
			$this->security->event(
				$uid,
				'organization.invited',
				array(
					'organization_id' => $org,
				)
			);
			return array( 'sent' => true );
		}
		if ( 'organizations/role' === $op && 'POST' === $method ) {
			$target = (int) $this->field( $r, 'user_id' );
			$role   = $this->field( $r, 'role', 16 );
			if ( ! in_array( $role, array( 'owner', 'admin', 'member' ), true ) ) {
				throw new Failure( 'invalid_role', 'Invalid role.' );
			}
			return $this->db->transaction(
				function () use (
					$org,
					$uid,
					$target,
					$role,
				) {
					$this->db->row(
						"SELECT id FROM {$this->db->prefix}organizations WHERE id=%s FOR UPDATE",
						$org,
					);
					// Locking reads after the organization lock: a plain read could reuse a snapshot
					// taken before a concurrent demotion committed, and leave the organization ownerless.
					$actor  = $this->member( $org, $uid, true );
					$member = $this->member( $org, $target, true );
					if ( 'owner' !== $actor['role'] ) {
						throw new Failure(
							'owner_required',
							'An owner must change roles.',
							403,
						);
					}
					if ( 'owner' === $member['role'] && 'owner' !== $role ) {
						$owners = $this->db->rows(
							"SELECT wp_user_id FROM {$this->db->prefix}members WHERE organization_id=%s AND role='owner' FOR UPDATE",
							$org,
						);
						if ( count( $owners ) < 2 ) {
							throw new Failure(
								'last_owner',
								'Add another owner first.',
								409,
							);
						}
					}
					$this->db->run(
						"UPDATE {$this->db->prefix}members SET role=%s WHERE organization_id=%s AND wp_user_id=%d",
						$role,
						$org,
						$target,
					);
					$this->security->event(
						$uid,
						'organization.role_changed',
						array(
							'organization_id' => $org,
							'user_id'         => $target,
							'role'            => $role,
						)
					);
					return array( 'updated' => true );
				}
			);
		}
		throw new Failure( 'not_found', 'Endpoint not found.', 404 );
	}
}
