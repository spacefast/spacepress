<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\CeremonyStep;

use function count;
use function first_identity_vendor_trigger_deprecation as trigger_deprecation;
use First\Identity\Vendor\Webauthn\AuthenticatorAssertionResponse;
use First\Identity\Vendor\Webauthn\AuthenticatorAttestationResponse;
use First\Identity\Vendor\Webauthn\CredentialRecord;
use First\Identity\Vendor\Webauthn\Exception\AuthenticatorResponseVerificationException;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialCreationOptions;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialRequestOptions;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialSource;

final class CheckAllowedCredentialList implements CeremonyStep
{
    public function process(
        CredentialRecord $credentialRecord,
        AuthenticatorAssertionResponse|AuthenticatorAttestationResponse $authenticatorResponse,
        PublicKeyCredentialRequestOptions|PublicKeyCredentialCreationOptions $publicKeyCredentialOptions,
        ?string $userHandle,
        string $host
    ): void {
        if ($credentialRecord instanceof PublicKeyCredentialSource) {
            first_identity_vendor_trigger_deprecation(
                'web-auth/webauthn-lib',
                '5.3',
                'Passing a PublicKeyCredentialSource to "%s::process()" is deprecated, pass a CredentialRecord instead.',
                self::class
            );
        }
        if (! $publicKeyCredentialOptions instanceof PublicKeyCredentialRequestOptions) {
            return;
        }
        if (count($publicKeyCredentialOptions->allowCredentials) === 0) {
            return;
        }

        foreach ($publicKeyCredentialOptions->allowCredentials as $allowedCredential) {
            if (hash_equals($allowedCredential->id, $credentialRecord->publicKeyCredentialId)) {
                return;
            }
        }
        throw AuthenticatorResponseVerificationException::create('The credential ID is not allowed.');
    }
}
