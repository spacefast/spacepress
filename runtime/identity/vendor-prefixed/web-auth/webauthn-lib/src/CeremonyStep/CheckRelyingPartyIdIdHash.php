<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\CeremonyStep;

use function is_string;
use function first_identity_vendor_trigger_deprecation as trigger_deprecation;
use First\Identity\Vendor\Webauthn\AuthenticationExtensions\AuthenticationExtensions;
use First\Identity\Vendor\Webauthn\AuthenticatorAssertionResponse;
use First\Identity\Vendor\Webauthn\AuthenticatorAttestationResponse;
use First\Identity\Vendor\Webauthn\CredentialRecord;
use First\Identity\Vendor\Webauthn\Exception\AuthenticatorResponseVerificationException;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialCreationOptions;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialRequestOptions;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialSource;
use First\Identity\Vendor\Webauthn\U2FPublicKey;

final class CheckRelyingPartyIdIdHash implements CeremonyStep
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
        $authData = $authenticatorResponse instanceof AuthenticatorAssertionResponse ? $authenticatorResponse->authenticatorData : $authenticatorResponse->attestationObject->authData;
        $C = $authenticatorResponse->clientDataJSON;
        $attestedCredentialData = $credentialRecord->getAttestedCredentialData();
        $credentialPublicKey = $attestedCredentialData->credentialPublicKey;
        $credentialPublicKey !== null || throw AuthenticatorResponseVerificationException::create(
            'No public key available.'
        );
        $isU2F = U2FPublicKey::isU2FKey($credentialPublicKey);
        $rpId = $publicKeyCredentialOptions->rpId ?? $publicKeyCredentialOptions->rp->id ?? $host;
        $facetId = $this->getFacetId($rpId, $publicKeyCredentialOptions->extensions, $authData->extensions);
        $rpIdHash = hash('sha256', $isU2F ? $C->origin : $facetId, true);
        hash_equals(
            $rpIdHash,
            $authData
                ->rpIdHash
        ) || throw AuthenticatorResponseVerificationException::create('rpId hash mismatch.');
    }

    private function getFacetId(
        string $rpId,
        AuthenticationExtensions $AuthenticationExtensions,
        null|AuthenticationExtensions $authenticationExtensionsClientOutputs
    ): string {
        if ($authenticationExtensionsClientOutputs === null || ! $AuthenticationExtensions->has(
            'appid'
        ) || ! $authenticationExtensionsClientOutputs->has('appid')) {
            return $rpId;
        }
        $appId = $AuthenticationExtensions->get('appid')
            ->value;
        $wasUsed = $authenticationExtensionsClientOutputs->get('appid')
            ->value;
        if (! is_string($appId) || $wasUsed !== true) {
            return $rpId;
        }
        return $appId;
    }
}
