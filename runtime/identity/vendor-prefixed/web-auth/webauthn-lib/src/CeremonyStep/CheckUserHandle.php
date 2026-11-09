<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\CeremonyStep;

use function first_identity_vendor_trigger_deprecation as trigger_deprecation;
use First\Identity\Vendor\Webauthn\AuthenticatorAssertionResponse;
use First\Identity\Vendor\Webauthn\AuthenticatorAttestationResponse;
use First\Identity\Vendor\Webauthn\CredentialRecord;
use First\Identity\Vendor\Webauthn\Exception\InvalidUserHandleException;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialCreationOptions;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialRequestOptions;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialSource;

final class CheckUserHandle implements CeremonyStep
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
        if (! $authenticatorResponse instanceof AuthenticatorAssertionResponse) {
            return;
        }
        $credentialUserHandle = $credentialRecord->userHandle;
        $responseUserHandle = $authenticatorResponse->userHandle;
        if ($userHandle !== null) { // If the user was identified before the authentication ceremony was initiated,
            hash_equals($credentialUserHandle, $userHandle) || throw InvalidUserHandleException::create();
            if ($responseUserHandle !== null && $responseUserHandle !== '') {
                hash_equals($credentialUserHandle, $responseUserHandle) || throw InvalidUserHandleException::create();
            }
        } else {
            ($responseUserHandle !== null && $responseUserHandle !== '' && hash_equals(
                $credentialUserHandle,
                $responseUserHandle
            ))
                || throw InvalidUserHandleException::create();
        }
    }
}
