<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\ClientDataCollector;

use First\Identity\Vendor\Webauthn\AuthenticatorResponse;
use First\Identity\Vendor\Webauthn\CollectedClientData;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialOptions;

interface ClientDataCollector
{
    /**
     * @return string[]
     */
    public function supportedTypes(): array;

    public function verifyCollectedClientData(
        CollectedClientData $collectedClientData,
        PublicKeyCredentialOptions $publicKeyCredentialOptions,
        AuthenticatorResponse $authenticatorResponse,
        string $host
    ): void;
}
