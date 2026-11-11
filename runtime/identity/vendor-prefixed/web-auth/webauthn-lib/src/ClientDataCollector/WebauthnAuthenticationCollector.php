<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\ClientDataCollector;

use function in_array;
use function sprintf;
use First\Identity\Vendor\Webauthn\AuthenticatorResponse;
use First\Identity\Vendor\Webauthn\CollectedClientData;
use First\Identity\Vendor\Webauthn\Exception\AuthenticatorResponseVerificationException;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialOptions;

final class WebauthnAuthenticationCollector implements ClientDataCollector
{
    public function supportedTypes(): array
    {
        return ['webauthn.get', 'webauthn.create'];
    }

    public function verifyCollectedClientData(
        CollectedClientData $collectedClientData,
        PublicKeyCredentialOptions $publicKeyCredentialOptions,
        AuthenticatorResponse $authenticatorResponse,
        string $host
    ): void {
        in_array(
            $collectedClientData->type,
            $this->supportedTypes(),
            true
        ) || throw AuthenticatorResponseVerificationException::create(
            sprintf('The client data type is not "%s" supported.', implode('", "', $this->supportedTypes()))
        );
    }
}
