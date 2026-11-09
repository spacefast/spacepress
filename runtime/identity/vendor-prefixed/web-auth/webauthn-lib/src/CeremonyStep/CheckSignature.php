<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\CeremonyStep;

use First\Identity\Vendor\CBOR\Decoder;
use First\Identity\Vendor\CBOR\Normalizable;
use First\Identity\Vendor\Cose\Algorithm\Manager;
use First\Identity\Vendor\Cose\Algorithm\Signature\ECDSA\ES256;
use First\Identity\Vendor\Cose\Algorithm\Signature\RSA\RS256;
use First\Identity\Vendor\Cose\Algorithm\Signature\Signature;
use First\Identity\Vendor\Cose\Key\Key;
use function is_array;
use function first_identity_vendor_trigger_deprecation as trigger_deprecation;
use First\Identity\Vendor\Webauthn\AuthenticatorAssertionResponse;
use First\Identity\Vendor\Webauthn\AuthenticatorAttestationResponse;
use First\Identity\Vendor\Webauthn\CredentialRecord;
use First\Identity\Vendor\Webauthn\Exception\AuthenticatorResponseVerificationException;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialCreationOptions;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialRequestOptions;
use First\Identity\Vendor\Webauthn\PublicKeyCredentialSource;
use First\Identity\Vendor\Webauthn\StringStream;
use First\Identity\Vendor\Webauthn\U2FPublicKey;
use First\Identity\Vendor\Webauthn\Util\CoseSignatureFixer;

final readonly class CheckSignature implements CeremonyStep
{
    private Manager $algorithmManager;

    public function __construct(null|Manager $algorithmManager = null)
    {
        $this->algorithmManager = $algorithmManager ?? Manager::create()->add(ES256::create(), RS256::create());
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
        if (! $authenticatorResponse instanceof AuthenticatorAssertionResponse) {
            return;
        }
        $credentialPublicKey = $credentialRecord->getAttestedCredentialData()
            ->credentialPublicKey;
        $credentialPublicKey !== null || throw AuthenticatorResponseVerificationException::create(
            'No public key available.'
        );
        $coseKey = $this->getCoseKey($credentialPublicKey);

        $getClientDataJSONHash = hash('sha256', $authenticatorResponse->clientDataJSON->rawData, true);
        $dataToVerify = $authenticatorResponse->authenticatorData->authData . $getClientDataJSONHash;
        $signature = $authenticatorResponse->signature;
        $algorithm = $this->algorithmManager->get($coseKey->alg());
        $algorithm instanceof Signature || throw AuthenticatorResponseVerificationException::create(
            'Invalid algorithm identifier. Should refer to a signature algorithm'
        );
        $signature = CoseSignatureFixer::fix($signature, $algorithm);
        $algorithm->verify(
            $dataToVerify,
            $coseKey,
            $signature
        ) || throw AuthenticatorResponseVerificationException::create('Invalid signature.');
    }

    private function getCoseKey(string $credentialPublicKey): Key
    {
        $isU2F = U2FPublicKey::isU2FKey($credentialPublicKey);
        if ($isU2F) {
            $credentialPublicKey = U2FPublicKey::convertToCoseKey($credentialPublicKey);
        }
        $stream = new StringStream($credentialPublicKey);
        $credentialPublicKeyStream = Decoder::create()->decode($stream);
        $stream->isEOF() || throw AuthenticatorResponseVerificationException::create(
            'Invalid key. Presence of extra bytes.'
        );
        $stream->close();
        $credentialPublicKeyStream instanceof Normalizable || throw AuthenticatorResponseVerificationException::create(
            'Invalid attestation object. Unexpected object.'
        );
        $normalizedData = $credentialPublicKeyStream->normalize();
        is_array($normalizedData) || throw AuthenticatorResponseVerificationException::create(
            'Invalid attestation object. Unexpected object.'
        );
        /** @var array<int|string, mixed> $normalizedData */

        return Key::create($normalizedData);
    }
}
