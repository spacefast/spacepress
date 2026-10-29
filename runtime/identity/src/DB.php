<?php

declare(strict_types=1);

namespace Zero\Identity;

final class DB
{
    public readonly string $prefix;
    private int $depth = 0;
    public function __construct(public readonly \wpdb $wp)
    {
        $this->prefix = $wp->prefix . "zero_identity_";
    }
    public function sql(string $sql, mixed ...$args): string
    {
        return $args ? $this->wp->prepare($sql, ...$args) : $sql;
    }
    public function run(string $sql, mixed ...$args): int
    {
        $result = $this->wp->query($this->sql($sql, ...$args));
        if ($result === false) {
            throw new Failure(
                "storage_conflict",
                "The operation conflicts with existing data. Please retry.",
                409,
            );
        }
        return $result;
    }
    public function row(string $sql, mixed ...$args): ?array
    {
        return $this->wp->get_row($this->sql($sql, ...$args), ARRAY_A);
    }
    public function rows(string $sql, mixed ...$args): array
    {
        return $this->wp->get_results($this->sql($sql, ...$args), ARRAY_A);
    }
    public function insert(string $table, array $data): int
    {
        if ($this->wp->insert($this->prefix . $table, $data) === false) {
            throw new Failure(
                "ownership_conflict",
                "This identity is already in use.",
                409,
            );
        }
        return (int) $this->wp->insert_id;
    }
    /**
     * Run $fn in a transaction. Identity shares WordPress's `$wpdb` connection, so when another
     * owner already has a transaction open on it (the Zero runtime reports one through the
     * `zero_identity_outer_transaction` filter) identity joins it with a savepoint instead of
     * issuing START TRANSACTION, which would silently commit the owner's work.
     */
    public function transaction(callable $fn): mixed
    {
        $level = $this->depth++;
        if ($level === 0 && apply_filters("zero_identity_outer_transaction", false)) {
            $level = 1;
        }
        $savepoint = "zero_identity_" . $this->depth;
        $this->run(
            $level === 0 ? "START TRANSACTION" : "SAVEPOINT " . $savepoint,
        );
        try {
            $value = $fn();
            $this->run(
                $level === 0 ? "COMMIT" : "RELEASE SAVEPOINT " . $savepoint,
            );
            return $value;
        } catch (\Throwable $e) {
            $this->run(
                $level === 0
                    ? "ROLLBACK"
                    : "ROLLBACK TO SAVEPOINT " . $savepoint,
            );
            throw $e;
        } finally {
            $this->depth--;
        }
    }
    public function lockSession(array $session): array
    {
        $uid = (int) $session["wp_user_id"];
        $this->lock($uid);
        $live = $this->row(
            "SELECT * FROM {$this->prefix}sessions WHERE id=%s AND wp_user_id=%d FOR UPDATE",
            $session["id"],
            $uid,
        );
        if (
            !$live ||
            $live["revoked_at"] !== null ||
            (int) $live["expires_at"] <= time() ||
            (int) $live["verified_at"] < time() - 300
        ) {
            throw new Failure(
                "reverification_required",
                "The session expired or was revoked. Confirm your identity again.",
                403,
            );
        }
        return $live;
    }
    public function credentialMutation(array $session, callable $fn): mixed
    {
        return $this->transaction(function () use ($session, $fn) {
            $this->lockSession($session);
            return $fn();
        });
    }
    public function lock(int $id): array
    {
        $row = $this->row(
            "SELECT * FROM {$this->prefix}accounts WHERE wp_user_id=%d FOR UPDATE",
            $id,
        );
        if (!$row || $row["status"] !== "active") {
            throw new Failure(
                "account_unavailable",
                "This account is unavailable.",
                403,
            );
        }
        return $row;
    }
}
