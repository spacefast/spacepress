<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\AttestationStatement;

use First\Identity\Vendor\Webauthn\AuthenticatorData;

interface AttestationStatementSupport
{
    public function name(): string;

    /**
     * @param array<string, mixed> $attestation
     */
    public function load(array $attestation): AttestationStatement;

    public function isValid(
        string $clientDataJSONHash,
        AttestationStatement $attestationStatement,
        AuthenticatorData $authenticatorData
    ): bool;
}
