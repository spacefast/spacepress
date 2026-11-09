<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\CeremonyStep;

use function first_identity_vendor_trigger_deprecation as trigger_deprecation;
use First\Identity\Vendor\Webauthn\AuthenticatorAssertionResponse;
use First\Identity\Vendor\Webauthn\AuthenticatorAttestationResponse;
use First\Identity\Vendor\Webauthn\CredentialRecord;
use First\Identity\Vendor\Webauthn\Exception\AuthenticatorResponseVerificationException;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialCreationOptions;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialRequestOptions;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialSource;

class CheckTopOrigin implements CeremonyStep
{
    public function __construct(
        private readonly null|TopOriginValidator $topOriginValidator = null
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
        $topOrigin = $authenticatorResponse->clientDataJSON->topOrigin;
        if ($topOrigin === null) {
            return;
        }
        if (! $authenticatorResponse->clientDataJSON->crossOrigin) {
            throw AuthenticatorResponseVerificationException::create('The response is not cross-origin.');
        }
        if ($this->topOriginValidator === null) {
            throw AuthenticatorResponseVerificationException::create(
                'A cross-origin response was received but no TopOriginValidator is configured. '
                . 'Configure one via CeremonyStepManagerFactory::enableTopOriginValidator() '
                . 'to opt in to cross-origin (iframe) ceremonies.'
            );
        }
        $this->topOriginValidator->validate($topOrigin);
    }
}
