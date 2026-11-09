<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\Counter;

use First\Identity\Vendor\Webauthn\CredentialRecord;

interface CounterChecker
{
    public function check(CredentialRecord $credentialRecord, int $currentCounter): void;
}
