<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\CeremonyStep;

use function first_identity_vendor_trigger_deprecation as trigger_deprecation;
use First\Identity\Vendor\Webauthn\AuthenticatorAssertionResponse;
use First\Identity\Vendor\Webauthn\AuthenticatorAttestationResponse;
use First\Identity\Vendor\Webauthn\AuthenticatorSelectionCriteria;
use First\Identity\Vendor\Webauthn\CredentialRecord;
use First\Identity\Vendor\Webauthn\Exception\AuthenticatorResponseVerificationException;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialCreationOptions;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialRequestOptions;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialSource;

final readonly class CheckUserVerification implements CeremonyStep
{
    public function __construct(
        private bool $requireUserVerification = true
    ) {
    }

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
        if (! $this->isUserVerificationRequired($publicKeyCredentialOptions)) {
            return;
        }
        $userVerification = $publicKeyCredentialOptions instanceof PublicKeyCredentialRequestOptions ? $publicKeyCredentialOptions->userVerification : $publicKeyCredentialOptions->authenticatorSelection?->userVerification;
        if ($userVerification !== AuthenticatorSelectionCriteria::USER_VERIFICATION_REQUIREMENT_REQUIRED) {
            return;
        }
        $authData = $authenticatorResponse instanceof AuthenticatorAssertionResponse ? $authenticatorResponse->authenticatorData : $authenticatorResponse->attestationObject->authData;
        $authData->isUserVerified() || throw AuthenticatorResponseVerificationException::create(
            'User authentication required.'
        );
    }

    private function isUserVerificationRequired(
        PublicKeyCredentialRequestOptions|PublicKeyCredentialCreationOptions $publicKeyCredentialOptions
    ): bool {
        if (! $this->requireUserVerification) {
            return false;
        }

        if ($publicKeyCredentialOptions instanceof PublicKeyCredentialCreationOptions
            && $publicKeyCredentialOptions->mediation === PublicKeyCredentialCreationOptions::MEDIATION_CONDITIONAL) {
            return false;
        }

        return true;
    }
}
