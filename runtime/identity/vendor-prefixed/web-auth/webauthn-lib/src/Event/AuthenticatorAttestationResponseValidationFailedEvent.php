<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\Event;

use Throwable;
use First\Identity\Vendor\Webauthn\AuthenticatorAttestationResponse;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialCreationOptions;

readonly class AuthenticatorAttestationResponseValidationFailedEvent
{
    public function __construct(
        public AuthenticatorAttestationResponse $authenticatorAttestationResponse,
        public PublicKeyCredentialCreationOptions $publicKeyCredentialCreationOptions,
        public string $host,
        public Throwable $throwable
    ) {
    }
}
