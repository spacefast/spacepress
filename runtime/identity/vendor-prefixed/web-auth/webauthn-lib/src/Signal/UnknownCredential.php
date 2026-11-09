<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\Signal;

use First\Identity\Vendor\Webauthn\PublicKeyCredentialDescriptor;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialRpEntity;

readonly class UnknownCredential implements Signal
{
    public function __construct(
        public PublicKeyCredentialRpEntity $rp,
        public PublicKeyCredentialDescriptor $credential,
    ) {
    }
}
