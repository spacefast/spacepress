<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\Signal;

use First\Identity\Vendor\Webauthn\PublicKeyCredentialDescriptor;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialRpEntity;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialUserEntity;

readonly class AllAcceptedCredentials implements Signal
{
    /**
     * @param PublicKeyCredentialDescriptor[] $allAcceptedCredentials
     */
    public function __construct(
        public PublicKeyCredentialRpEntity $rp,
        public PublicKeyCredentialUserEntity $user,
        public array $allAcceptedCredentials,
    ) {
    }
}
